#!/usr/bin/env python3
"""
Userbot forwarder — Telethon. Modes:

  python userbot_forward.py discover
    List every chat your account sees, with its numeric ID.

  python userbot_forward.py audit
    Read-only sample of each source in SOURCE_CHATS. Reports total count,
    date range, % with media, % bot-authored, % matched by the
    solicitation lexicon, plus printed samples (random + lexicon-hits).
    Run this BEFORE bulk to sanity-check filter behaviour and decide
    which sources to actually forward.

  python userbot_forward.py bulk
    Forward each SOURCE_CHATS entry into DEST_CHAT, oldest-first,
    throttled. Filters: no media, no bot-authored, no lexicon hits,
    no duplicates (cross-source content-hash + per-source min_id).
    Resumable via userbot_forward_state.json.

  python userbot_forward.py live
    Stay connected; forward each new TEXT message in SOURCE_CHATS to
    DEST_CHAT in real time. Same filters as bulk.

Setup: pip install telethon python-dotenv ; set TG_API_ID + TG_API_HASH
in .env / .env.local ; first run prompts for phone + login code.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import random
import re
import sys
from datetime import datetime
from pathlib import Path

from telethon import TelegramClient, events
from telethon.errors import FloodWaitError
from telethon.tl.types import User

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
    load_dotenv(Path(__file__).parent.parent / ".env.local")
except ImportError:
    pass

API_ID = int(os.environ.get("TG_API_ID", "0"))
API_HASH = os.environ.get("TG_API_HASH", "")

# ---- CONFIG ---------------------------------------------------------------

# Run `discover` first, paste IDs here. Negative IDs for groups/channels.
SOURCE_CHATS: list[int] = [
    -1003974413924,  # Queensland Vouch Forwards (channel)
    # -1002456866292,  # Forwards — uncomment after auditing
]

DEST_CHAT: int = -1003728299216  # SC45.

BULK_DELAY_SECONDS = 10.0     # Pacing for `bulk`. Conservative for main account.
AUDIT_SAMPLE_PER_SOURCE = 300  # How many messages to sample in `audit`.

SESSION_NAME = str(Path(__file__).parent / "userbot")
STATE_FILE = Path(__file__).parent / "userbot_forward_state.json"

# ---- LEXICON --------------------------------------------------------------
# Ported from src/core/chatModerationLexicon.ts. Keep these in sync if the TS
# version changes. Empirically tuned over 24k messages (KB:F2.18, F2.19).

LEET_MAP = {
    "0": "o", "1": "i", "3": "e", "4": "a", "5": "s",
    "7": "t", "8": "b", "@": "a", "$": "s",
}

PHRASES: frozenset[str] = frozenset({
    "briar", "buying", "come thru", "dm me", "drop off", "f2f",
    "front", "got some", "got the", "hit me up", "hmu", "holding",
    "how much", "in stock", "inbox me", "meet up", "owe me", "p2p",
    "pickup", "pm me", "selling", "session", "signal me", "sold",
    "stocked", "threema", "tic", "tick", "what for", "what u sell",
    "what's the price", "wickr", "wickr me", "wtb", "wts", "wtt",
})

REGEX_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("tme_invite",         re.compile(r"t\.me/\+|t\.me/joinchat|telegram\.me/\+", re.I)),
    ("phone",              re.compile(r"\b\+?\d[\d\s\-]{7,}\d\b")),
    ("crypto_wallet",      re.compile(r"\b(bc1[a-z0-9]{20,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|0x[a-fA-F0-9]{40}|T[1-9A-HJ-NP-Za-km-z]{33})\b")),
    ("email",              re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")),
    ("vouch_heading",      re.compile(r"\b(?:pos|neg|mix)\s+vouch\b", re.I)),
    ("vouch_for_username", re.compile(r"\bvouch(?:ing|ed)?\b[^\n]{0,30}@[A-Za-z]", re.I)),
    ("vouch_shorthand",    re.compile(r"[+\-]vouch\b", re.I)),
]

BUY_STEM = re.compile(
    r"\b(?:anyone|who(?:'s|s)?|chasing|looking for|need|wtb|after some)\b"
    r"[^@\n]{0,50}"
    r"\b(?:bud|buds|gas|tabs|ket|ketamine|vals|carts|wax|coke|cocaine|mdma|md|mda|"
    r"lsd|acid|shrooms|mushies|oxy|xan|xanax|pingers|pills|press|presses|caps|weed|"
    r"meth|ice|crystal|oz|qp|hp|gram|d9|dispo)\b",
    re.I,
)
SOLICIT_CONTACT_CTA = re.compile(r"\b(?:pm|dm|hmu|hit me|inbox|message me)\b", re.I)


def normalize(text: str) -> str:
    out = text.lower()
    out = "".join(LEET_MAP.get(c, c) for c in out)
    out = re.sub(r"([a-z])[^a-z0-9 ]+([a-z])", r"\1\2", out)
    out = re.sub(r"[^a-z0-9]+", " ", out)
    out = re.sub(r"\s+", " ", out).strip()
    return out


def find_hit(text: str) -> str | None:
    """Return source-of-hit string, or None if message is clean."""
    if not text:
        return None
    padded = f" {normalize(text)} "
    for phrase in PHRASES:
        if f" {phrase} " in padded:
            return f"phrase:{phrase}"
    for name, regex in REGEX_PATTERNS:
        if regex.search(text):
            return f"regex_{name}"
    if BUY_STEM.search(text) and SOLICIT_CONTACT_CTA.search(text):
        return "compound_buy_solicit"
    return None


# ---- STATE ----------------------------------------------------------------

def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    state = {"last_id": {}, "fingerprints": []}
    return state


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2))


def content_fingerprint(text: str) -> str:
    """sha1 of normalised text. Catches duplicates across sources where a
    message appears in multiple archives (e.g. Forwards + QV Forwards)."""
    n = normalize(text)
    return hashlib.sha1(n.encode("utf-8")).hexdigest()[:16]


# ---- HELPERS --------------------------------------------------------------

def is_bot_message(msg) -> bool:
    if msg.via_bot_id:
        return True
    sender = msg.sender
    if isinstance(sender, User) and sender.bot:
        return True
    return False


def message_text(msg) -> str:
    return (msg.message or "").strip()


def has_media(msg) -> bool:
    return msg.media is not None


def skip_reason(msg) -> str | None:
    """Return a reason-string if msg should be skipped, else None."""
    if has_media(msg):
        return "media"
    if is_bot_message(msg):
        return "bot"
    text = message_text(msg)
    if not text:
        return "empty"
    hit = find_hit(text)
    if hit:
        return f"lex:{hit}"
    return None


# ---- MODES ----------------------------------------------------------------

async def cmd_discover(client: TelegramClient) -> None:
    print(f"{'ID':>20}  {'TYPE':<10}  NAME")
    print("-" * 80)
    async for dialog in client.iter_dialogs():
        kind = "channel" if dialog.is_channel else ("group" if dialog.is_group else "user")
        print(f"{dialog.id:>20}  {kind:<10}  {dialog.name}")


async def cmd_audit(client: TelegramClient) -> None:
    if not SOURCE_CHATS:
        sys.exit("Configure SOURCE_CHATS first.")

    for src_id in SOURCE_CHATS:
        try:
            src = await client.get_entity(src_id)
        except Exception as e:
            print(f"\n[audit] cannot resolve {src_id}: {e}")
            continue
        title = getattr(src, "title", str(src_id))
        print(f"\n========== {title} ({src_id}) ==========")

        total = 0
        media_n = 0
        bot_n = 0
        empty_n = 0
        hit_n = 0
        first_date = None
        last_date = None
        hit_samples: list[str] = []
        clean_samples: list[str] = []
        all_text_samples: list[str] = []

        async for msg in client.iter_messages(src, limit=AUDIT_SAMPLE_PER_SOURCE):
            total += 1
            if first_date is None or msg.date < first_date:
                first_date = msg.date
            if last_date is None or msg.date > last_date:
                last_date = msg.date

            if has_media(msg):
                media_n += 1
            if is_bot_message(msg):
                bot_n += 1
            text = message_text(msg)
            if not text:
                empty_n += 1
                continue
            hit = find_hit(text)
            if hit:
                hit_n += 1
                if len(hit_samples) < 5:
                    hit_samples.append(f"  [{hit}] {text[:160]}")
            else:
                if len(clean_samples) < 5 and not has_media(msg) and not is_bot_message(msg):
                    clean_samples.append(f"  {text[:160]}")
            if len(all_text_samples) < 50:
                all_text_samples.append(text[:120])

        # Estimate total chat size by reading top message id
        try:
            top = await client.get_messages(src, limit=1)
            est_total = top[0].id if top else "?"
        except Exception:
            est_total = "?"

        print(f"sampled:        {total}")
        print(f"top_message_id: {est_total}  (rough total messages)")
        print(f"date_range:     {first_date} -> {last_date}")
        print(f"media:          {media_n} ({pct(media_n, total)})")
        print(f"bot_authored:   {bot_n} ({pct(bot_n, total)})")
        print(f"empty/no-text:  {empty_n} ({pct(empty_n, total)})")
        print(f"lexicon_hits:   {hit_n} ({pct(hit_n, total)})")
        forwardable = total - media_n - bot_n - empty_n - hit_n
        print(f"forwardable:    {forwardable} ({pct(forwardable, total)}) of sampled")
        print(f"\n  -- lexicon-hit samples --")
        for s in hit_samples:
            print(s)
        print(f"\n  -- clean text samples --")
        for s in clean_samples:
            print(s)


def pct(n: int, total: int) -> str:
    if total == 0:
        return "0%"
    return f"{(n / total) * 100:.1f}%"


async def cmd_bulk(client: TelegramClient) -> None:
    if not SOURCE_CHATS or not DEST_CHAT:
        sys.exit("Configure SOURCE_CHATS and DEST_CHAT.")

    state = load_state()
    state.setdefault("last_id", {})
    state.setdefault("fingerprints", [])
    fp_set: set[str] = set(state["fingerprints"])

    dest = await client.get_entity(DEST_CHAT)
    print(f"[bulk] dest = {getattr(dest, 'title', DEST_CHAT)}")

    skipped_log = Path(__file__).parent / "userbot_forward_skipped.log"
    skipped_handle = skipped_log.open("a", encoding="utf-8")

    grand_fwd = 0
    grand_skip: dict[str, int] = {}

    for src_id in SOURCE_CHATS:
        try:
            src = await client.get_entity(src_id)
        except Exception as e:
            print(f"[bulk] cannot resolve {src_id}: {e} — skipping source")
            continue

        last_id = int(state["last_id"].get(str(src_id), 0))
        title = getattr(src, "title", str(src_id))
        print(f"\n[bulk] {title} ({src_id}) — resuming from msg id > {last_id}")

        forwarded = 0
        per_src_skip: dict[str, int] = {}

        async for msg in client.iter_messages(src, reverse=True, min_id=last_id):
            reason = skip_reason(msg)
            if reason is None:
                fp = content_fingerprint(message_text(msg))
                if fp in fp_set:
                    reason = "dup"

            if reason is not None:
                per_src_skip[reason] = per_src_skip.get(reason, 0) + 1
                grand_skip[reason] = grand_skip.get(reason, 0) + 1
                if reason.startswith("lex:"):
                    snippet = message_text(msg)[:200].replace("\n", " ")
                    skipped_handle.write(f"{datetime.utcnow().isoformat()}\t{src_id}\t{msg.id}\t{reason}\t{snippet}\n")
                    skipped_handle.flush()
            else:
                try:
                    await client.forward_messages(dest, msg)
                    forwarded += 1
                    grand_fwd += 1
                    fp_set.add(content_fingerprint(message_text(msg)))
                except FloodWaitError as e:
                    print(f"  flood-wait {e.seconds}s, sleeping...")
                    await asyncio.sleep(e.seconds + 1)
                    await client.forward_messages(dest, msg)
                    forwarded += 1
                    grand_fwd += 1
                    fp_set.add(content_fingerprint(message_text(msg)))
                except Exception as e:
                    per_src_skip["error"] = per_src_skip.get("error", 0) + 1
                    print(f"  forward fail msg {msg.id}: {e}")
                await asyncio.sleep(BULK_DELAY_SECONDS)

            state["last_id"][str(src_id)] = msg.id
            if (forwarded + sum(per_src_skip.values())) % 25 == 0:
                state["fingerprints"] = sorted(fp_set)
                save_state(state)
                print(f"  fwd={forwarded} skip={per_src_skip} last_id={msg.id}")

        state["fingerprints"] = sorted(fp_set)
        save_state(state)
        print(f"[bulk] done {title}: fwd={forwarded} skip={per_src_skip}")

    skipped_handle.close()
    print(f"\n[bulk] TOTAL fwd={grand_fwd} skip={grand_skip}")
    print(f"[bulk] lexicon-skip details in: {skipped_log}")


async def cmd_live(client: TelegramClient) -> None:
    if not SOURCE_CHATS or not DEST_CHAT:
        sys.exit("Configure SOURCE_CHATS and DEST_CHAT.")

    state = load_state()
    state.setdefault("fingerprints", [])
    fp_set: set[str] = set(state["fingerprints"])

    @client.on(events.NewMessage(chats=SOURCE_CHATS))
    async def handler(event):
        msg = event.message
        reason = skip_reason(msg)
        if reason is None:
            fp = content_fingerprint(message_text(msg))
            if fp in fp_set:
                reason = "dup"
        if reason is not None:
            print(f"[live] skip msg {msg.id} reason={reason}")
            return
        try:
            await client.forward_messages(DEST_CHAT, msg)
            fp_set.add(content_fingerprint(message_text(msg)))
            state["fingerprints"] = sorted(fp_set)
            save_state(state)
            print(f"[live] fwd msg {msg.id} from {event.chat_id}")
        except FloodWaitError as e:
            print(f"[live] flood-wait {e.seconds}s")
            await asyncio.sleep(e.seconds + 1)
            await client.forward_messages(DEST_CHAT, msg)

    print(f"[live] watching {len(SOURCE_CHATS)} chats -> {DEST_CHAT}. Ctrl+C to stop.")
    await client.run_until_disconnected()


# ---- ENTRY ----------------------------------------------------------------

async def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in {"discover", "audit", "bulk", "live"}:
        sys.exit(__doc__)
    if not API_ID or not API_HASH:
        sys.exit("Set TG_API_ID and TG_API_HASH in .env (from https://my.telegram.org).")

    async with TelegramClient(SESSION_NAME, API_ID, API_HASH) as client:
        cmd = sys.argv[1]
        if cmd == "discover":
            await cmd_discover(client)
        elif cmd == "audit":
            await cmd_audit(client)
        elif cmd == "bulk":
            await cmd_bulk(client)
        elif cmd == "live":
            await cmd_live(client)


if __name__ == "__main__":
    asyncio.run(main())

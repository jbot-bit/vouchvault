import { test } from "node:test";
import assert from "node:assert/strict";

// v9: the DM wizard is gone, so the bot no longer mints any callback_data
// strings of its own. This test stays as a guardrail: if a future change
// reintroduces callbacks, append them here so the 64-byte ceiling check
// runs in CI from day one.
const KNOWN_CALLBACKS: string[] = [
  // Inline-cards phase 3: /forgeries pagination.
  "vc:p:0",
  "vc:p:1",
  "vc:p:99",
  "vc:p:99999999",
];

test("every callback data string is <= 64 bytes", () => {
  for (const cb of KNOWN_CALLBACKS) {
    const bytes = Buffer.byteLength(cb, "utf8");
    assert.ok(bytes <= 64, `${cb} is ${bytes} bytes`);
  }
});

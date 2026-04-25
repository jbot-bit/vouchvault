import test from "node:test";
import assert from "node:assert/strict";

import {
  isLauncherDebounceActive,
  LAUNCHER_REFRESH_DEBOUNCE_MS,
} from "./launcherPolicy.ts";

test("isLauncherDebounceActive returns true within the debounce window", () => {
  const now = 1_000_000_000;
  const updatedAt = new Date(now - (LAUNCHER_REFRESH_DEBOUNCE_MS - 1));
  assert.equal(isLauncherDebounceActive(updatedAt, now), true);
});

test("isLauncherDebounceActive returns false at the exact window boundary", () => {
  const now = 1_000_000_000;
  const updatedAt = new Date(now - LAUNCHER_REFRESH_DEBOUNCE_MS);
  assert.equal(isLauncherDebounceActive(updatedAt, now), false);
});

test("isLauncherDebounceActive returns false past the debounce window", () => {
  const now = 1_000_000_000;
  const updatedAt = new Date(now - (LAUNCHER_REFRESH_DEBOUNCE_MS + 5_000));
  assert.equal(isLauncherDebounceActive(updatedAt, now), false);
});

test("isLauncherDebounceActive accepts a custom debounce override", () => {
  const now = 2_000;
  assert.equal(isLauncherDebounceActive(new Date(1_500), now, 1_000), true);
  assert.equal(isLauncherDebounceActive(new Date(900), now, 1_000), false);
});

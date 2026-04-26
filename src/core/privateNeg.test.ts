import test from "node:test";
import assert from "node:assert/strict";

import { shouldPublishToGroup } from "./archive.ts";

test("shouldPublishToGroup is true for positive", () => {
  assert.equal(shouldPublishToGroup("positive"), true);
});

test("shouldPublishToGroup is true for mixed", () => {
  assert.equal(shouldPublishToGroup("mixed"), true);
});

test("shouldPublishToGroup is false for negative", () => {
  assert.equal(shouldPublishToGroup("negative"), false);
});

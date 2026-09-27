import test from "node:test";
import assert from "node:assert/strict";
import { createWindowRateLimiter } from "../server/request-limit.ts";

const windowMs = 15 * 60 * 1000;

test("normal student retries are allowed, excessive repeats wait for the next window", () => {
  const take = createWindowRateLimiter(windowMs);
  for (let n = 0; n < 8; n++) assert.equal(take("student:class-a:5-1-2", 8, 0).allowed, true);
  const denied = take("student:class-a:5-1-2", 8, 0);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 900);
  assert.equal(take("student:class-a:5-1-2", 8, windowMs).allowed, true);
});

test("a class quota does not affect another class", () => {
  const take = createWindowRateLimiter(windowMs);
  for (let n = 0; n < 300; n++) assert.equal(take("class:class-a", 300, 0).allowed, true);
  assert.equal(take("class:class-a", 300, 0).allowed, false);
  assert.equal(take("class:class-b", 300, 0).allowed, true);
});

test("AI regeneration has separate submission and class quotas", () => {
  const take = createWindowRateLimiter(windowMs);
  for (let n = 0; n < 6; n++) assert.equal(take("ai:class-a:submission-a", 6, 0).allowed, true);
  assert.equal(take("ai:class-a:submission-a", 6, 0).allowed, false);
  assert.equal(take("ai:class-a:submission-b", 6, 0).allowed, true);
  assert.equal(take("ai:class-b:submission-a", 6, 0).allowed, true);
});

test("bounded storage evicts a key without globally blocking new users", () => {
  const take = createWindowRateLimiter(windowMs, 2);
  assert.equal(take("one", 1, 0).allowed, true);
  assert.equal(take("two", 1, 0).allowed, true);
  assert.equal(take("three", 1, 0).allowed, true);
  assert.equal(take("two", 1, 0).allowed, false);
});

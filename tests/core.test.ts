import test from "node:test";
import assert from "node:assert/strict";
import { challenge, evaluate, Store } from "../src/core.js";

const traceFor = (targets: ReturnType<typeof challenge>, start = 0) => targets.flatMap((target, index) => [0, 130].map((offset) => ({ t: start + index * 260 + offset, x: target.x, y: target.y, visible: true, angle: 0 as const })));

test("challenge has two different bounded directions then center", () => {
  const generated = challenge(() => .1);
  assert.equal(generated.length, 3); assert.notEqual(generated[0]!.direction, generated[1]!.direction);
  assert.equal(generated[2]!.direction, "center"); assert.ok(generated.every((target) => Math.abs(target.x) <= 8 && Math.abs(target.y) <= 8));
});

test("motion evaluation requires ordered, plausible, uninterrupted samples", () => {
  const targets = [{ direction: "right" as const, x: 8, y: 0 }, { direction: "up" as const, x: 0, y: -8 }, { direction: "center" as const, x: 0, y: 0 }];
  const trace = traceFor(targets);
  assert.equal(evaluate(targets, trace, 1000), true); assert.equal(evaluate(targets, [...trace].reverse(), 1000), false);
  assert.equal(evaluate(targets, trace.map((sample, index) => index === 2 ? { ...sample, visible: false } : sample), 1000), false);
  assert.equal(evaluate(targets, trace.map((sample, index) => index === 2 ? { ...sample, x: 1000 } : sample), 1000), false);
});

test("result lifetime starts at success and lasts five minutes", () => {
  let now = 0; const store = new Store(() => now);
  const session = store.create({ origin: "https://shop.test", action: "buy", transactionId: "tx" });
  now = 119_000; const token = store.succeed(session, "direct_motion"); now = 418_999;
  assert.equal((store.redeem(token, { origin: session.origin, action: session.action, transactionId: session.transactionId, idempotencyKey: "one" }) as any).outcome, "valid_consumed");
});

test("redemption requires an isolated idempotency key and consumes once", () => {
  const store = new Store(() => 0), session = store.create({ origin: "https://shop.test", action: "buy", transactionId: "tx" });
  const token = store.succeed(session, "direct_motion"), input = { origin: session.origin, action: session.action, transactionId: session.transactionId, idempotencyKey: "one" };
  assert.equal((store.redeem(token, { ...input, idempotencyKey: "" }) as any).outcome, "invalid_request");
  assert.equal((store.redeem(token, input) as any).outcome, "valid_consumed"); assert.equal((store.redeem(token, input) as any).outcome, "valid_consumed");
  assert.equal((store.redeem(token, { ...input, idempotencyKey: "two" }) as any).outcome, "already_consumed");
});

test("handoff bearer is one-time and replacement revokes the connected lease", () => {
  const store = new Store(() => 0), session = store.create({ origin: "https://shop.test", action: "buy", transactionId: "tx" });
  const bearer = store.issueHandoff(session), lease = store.connectPhone(session, bearer, "phone-a");
  assert.equal(store.authorizePhone(session, lease), true); assert.throws(() => store.connectPhone(session, bearer, "phone-a"));
  const replacement = store.issueHandoff(session); assert.notEqual(replacement, bearer); assert.equal(store.authorizePhone(session, lease), false);
});

test("cancelled and consumed sessions cannot be resurrected", () => {
  const store = new Store(() => 0), cancelled = store.create({ origin: "https://shop.test", action: "buy", transactionId: "cancel" });
  const bearer = store.issueHandoff(cancelled); store.cancel(cancelled);
  assert.throws(() => store.connectPhone(cancelled, bearer, "phone")); assert.throws(() => store.freshAttempt(cancelled));
  const consumed = store.create({ origin: "https://shop.test", action: "buy", transactionId: "consume" }), token = store.succeed(consumed, "direct_motion");
  store.redeem(token, { origin: consumed.origin, action: consumed.action, transactionId: consumed.transactionId, idempotencyKey: "consume" });
  assert.throws(() => store.issueHandoff(consumed)); assert.throws(() => store.succeed(consumed, "direct_motion"));
});

test("phone lease expires without heartbeat", () => {
  let now = 0; const store = new Store(() => now), session = store.create({ origin: "https://shop.test", action: "buy", transactionId: "tx" });
  const lease = store.connectPhone(session, store.issueHandoff(session), "phone"); now = 15_001;
  assert.equal(store.authorizePhone(session, lease), false); assert.equal(session.status, "pending");
});

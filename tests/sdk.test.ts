import test from "node:test";
import assert from "node:assert/strict";
import { MotionPresenceClient, MotionPresenceError } from "../src/integration-sdk.js";

const options = { baseUrl: "https://verify.test", serverSecret: "secret", origin: "https://shop.test" };
test("SDK sends scoped authenticated redemption and returns typed outcome", async () => {
  let request: Request | undefined;
  const client = new MotionPresenceClient({ ...options, fetch: async (input, init) => { request = new Request(input, init); return Response.json({ outcome: "valid_consumed", action: "buy", transactionId: "tx", method: "direct_motion", completedAt: new Date(0).toISOString() }); } });
  const result = await client.redeem({ resultToken: "result", action: "buy", transactionId: "tx", idempotencyKey: "once" });
  assert.equal(result.outcome, "valid_consumed"); assert.equal(request!.headers.get("authorization"), "Bearer secret"); assert.equal(request!.headers.get("idempotency-key"), "once");
  assert.deepEqual(await request!.json(), { resultToken: "result", action: "buy", transactionId: "tx", origin: "https://shop.test" });
});
test("SDK normalizes authentication and network errors without exposing secrets", async () => {
  const unauthorized = new MotionPresenceClient({ ...options, fetch: async () => new Response("", { status: 401 }) });
  await assert.rejects(unauthorized.redeem({ resultToken: "x", action: "buy", transactionId: "tx", idempotencyKey: "key" }), (error: MotionPresenceError) => error.code === "unauthorized" && !error.message.includes("secret"));
  const offline = new MotionPresenceClient({ ...options, fetch: async () => { throw Error("socket"); } });
  await assert.rejects(offline.redeem({ resultToken: "x", action: "buy", transactionId: "tx", idempotencyKey: "key" }), (error: MotionPresenceError) => error.code === "unavailable");
});

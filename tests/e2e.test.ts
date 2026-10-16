import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
process.env.NODE_ENV = "test"; process.env.MPV_DEMO_ALTERNATIVE_CODE = "test-only-code";
const { handler, store } = await import("../src/server.js");

async function fixture() {
  store.sessions.clear(); store.idempotency.clear();
  const server = createServer(handler); await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${(server.address() as any).port}`;
  const desktopTokens = new Map<string, string>();
  const call = async (path: string, init: any = {}) => {
    const sessionId = path.match(/^\/v1\/sessions\/([^/?]+)/)?.[1], sessionToken = sessionId ? desktopTokens.get(sessionId) : undefined;
    const response = await fetch(base + path, { ...init, headers: { origin: "http://localhost:3000", "content-type": "application/json", ...(sessionToken ? { "x-session-token": sessionToken } : {}), ...(init.headers || {}) } });
    const data = await response.json() as any;
    if (data.sessionId && data.sessionToken) desktopTokens.set(data.sessionId, data.sessionToken);
    return { status: response.status, data };
  };
  return { server, call };
}
const make = (call: any, transactionId: string) => call("/v1/sessions", { method: "POST", body: JSON.stringify({ siteKey: "pk_local_demo", action: "demo_purchase", transactionId }) });

test("alternative evidence authorizes exactly one protected purchase", async () => {
  const { server, call } = await fixture(); try {
    const made = await make(call, "tx-alt");
    assert.equal((await call("/demo/alternative", { method: "POST", body: JSON.stringify({ sessionId: made.data.sessionId, transactionId: "tx-alt", code: "wrong" }) })).status, 401);
    const verified = await call("/demo/alternative", { method: "POST", body: JSON.stringify({ sessionId: made.data.sessionId, transactionId: "tx-alt", code: "test-only-code" }) });
    assert.equal((await call("/demo/purchase", { method: "POST", body: JSON.stringify({ resultToken: verified.data.resultToken, transactionId: "tx-alt" }) })).status, 200);
    assert.equal((await call("/demo/purchase", { method: "POST", body: JSON.stringify({ resultToken: verified.data.resultToken, transactionId: "other" }) })).status, 403);
  } finally { server.close(); }
});

test("QR replacement revokes old bearer and old connected phone lease", async () => {
  const { server, call } = await fixture(); try {
    const made = await make(call, "tx-qr"), first = await call(`/v1/sessions/${made.data.sessionId}/handoff`, { method: "POST" });
    const firstToken = new URL(first.data.link).hash.slice(1), connected = await call("/v1/handoffs/connect", { method: "POST", body: JSON.stringify({ sessionId: made.data.sessionId, token: firstToken, phoneId: "phone-a" }) });
    const replacement = await call(`/v1/sessions/${made.data.sessionId}/handoff`, { method: "POST" });
    assert.equal((await call(`/v1/sessions/${made.data.sessionId}/heartbeat`, { method: "POST", headers: { "x-phone-lease": connected.data.phoneLease } })).status, 401);
    assert.equal((await call("/v1/handoffs/connect", { method: "POST", body: JSON.stringify({ sessionId: made.data.sessionId, token: firstToken, phoneId: "phone-a" }) })).status, 410);
    assert.notEqual(new URL(replacement.data.link).hash.slice(1), firstToken);
    const leaked = await fetch(`http://localhost:${(server.address() as any).port}/v1/sessions/${made.data.sessionId}`, { headers: { origin: "http://localhost:3000" } });
    assert.equal(leaked.status, 401);
  } finally { server.close(); }
});

test("connected phone owns attempt invalidation", async () => {
  const { server, call } = await fixture(); try {
    const made = await make(call, "tx-owner"), handoff = await call(`/v1/sessions/${made.data.sessionId}/handoff`, { method: "POST" });
    const connected = await call("/v1/handoffs/connect", { method: "POST", body: JSON.stringify({ sessionId: made.data.sessionId, token: new URL(handoff.data.link).hash.slice(1), phoneId: "phone" }) });
    assert.equal((await call(`/v1/sessions/${made.data.sessionId}/attempts`, { method: "POST", body: JSON.stringify({ invalidate: true }) })).status, 401);
    assert.equal((await call(`/v1/sessions/${made.data.sessionId}/attempts`, { method: "POST", headers: { "x-phone-lease": connected.data.phoneLease }, body: JSON.stringify({ invalidate: true }) })).status, 200);
  } finally { server.close(); }
});

test("cancelled and consumed sessions reject handoff reconnection", async () => {
  const { server, call } = await fixture(); try {
    const cancelled = await make(call, "tx-cancel"), handoff = await call(`/v1/sessions/${cancelled.data.sessionId}/handoff`, { method: "POST" });
    await call(`/v1/sessions/${cancelled.data.sessionId}/cancel`, { method: "POST" });
    assert.equal((await call("/v1/handoffs/connect", { method: "POST", body: JSON.stringify({ sessionId: cancelled.data.sessionId, token: new URL(handoff.data.link).hash.slice(1), phoneId: "phone" }) })).status, 410);
    const consumed = await make(call, "tx-consumed"), verified = await call(`/v1/sessions/${consumed.data.sessionId}/alternative`, { method: "POST", headers: { authorization: "Bearer local-development-secret" }, body: JSON.stringify({ method: "reviewed_accessibility" }) });
    await call("/demo/purchase", { method: "POST", body: JSON.stringify({ resultToken: verified.data.resultToken, transactionId: "tx-consumed" }) });
    assert.equal((await call(`/v1/sessions/${consumed.data.sessionId}/handoff`, { method: "POST" })).status, 409);
  } finally { server.close(); }
});

test("server redemption rejects a missing idempotency key", async () => {
  const { server, call } = await fixture(); try { assert.equal((await call("/v1/results/redeem", { method: "POST", headers: { authorization: "Bearer local-development-secret" }, body: "{}" })).status, 400); } finally { server.close(); }
});

test("authenticated merchant redemption works without a browser Origin", async () => {
  const { server } = await fixture(); try {
    const response = await fetch(`http://localhost:${(server.address() as any).port}/v1/results/redeem`, { method: "POST", headers: { authorization: "Bearer local-development-secret", "content-type": "application/json", "idempotency-key": "server-call" }, body: "{}" });
    assert.equal(response.status, 200); assert.equal((await response.json() as any).outcome, "invalid");
  } finally { server.close(); }
});

test("state-changing API rejects requests without an Origin", async () => {
  const { server } = await fixture(); try {
    const response = await fetch(`http://localhost:${(server.address() as any).port}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(response.status, 403);
  } finally { server.close(); }
});

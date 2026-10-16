import test from "node:test";
import assert from "node:assert/strict";
import { Telemetry } from "../src/telemetry.js";

test("telemetry persists only coarse events and aggregates routes", () => {
  const telemetry = new Telemetry(":memory:");
  telemetry.record({ sessionId: "secret-session", event: "session_started" });
  telemetry.record({ sessionId: "secret-session", event: "verification_completed", route: "direct", durationMs: 1200 });
  const summary = telemetry.summary();
  assert.equal(summary.totals.find((row) => row.event === "verification_completed")?.count, 1);
  assert.deepEqual(telemetry.recent().map((row) => row.event), ["verification_completed", "session_started"]);
  assert.equal(JSON.stringify({ summary, recent: telemetry.recent() }).includes("secret-session"), false);
  assert.equal(telemetry.enforceRetention(Date.now() + 31 * 86_400_000), 2); assert.equal(telemetry.recent().length, 0);
  telemetry.close();
});

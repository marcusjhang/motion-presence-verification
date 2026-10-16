import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { Store, digest, evaluate, opaque, safeEqual, type Method, type Session } from "./core.js";
import { Telemetry } from "./telemetry.js";

export const store = new Store();
export const telemetry = new Telemetry(process.env.NODE_ENV === "test" ? ":memory:" : undefined);
const streams = new Map<string, Set<ServerResponse>>();
const serverSecret = process.env.MPV_SERVER_SECRET ?? "local-development-secret";
if (process.env.NODE_ENV === "production" && !process.env.MPV_SERVER_SECRET) throw new Error("MPV_SERVER_SECRET is required in production");
const operatorToken = process.env.MPV_OPERATOR_TOKEN;
const publishableKey = "pk_local_demo";
const allowedOrigin = process.env.MPV_ORIGIN ?? "http://localhost:3000";
const actions = new Set(["demo_purchase"]);
const demoAlternativeCode = process.env.MPV_DEMO_ALTERNATIVE_CODE;
const securityHeaders = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "permissions-policy": "accelerometer=(self), gyroscope=(self)", "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'" };
const rateBuckets = new Map<string, { count: number; resetsAt: number }>();
const json = (res: ServerResponse, status: number, data: unknown) => { res.writeHead(status, { ...securityHeaders, "content-type": "application/json" }); res.end(JSON.stringify(data)); };
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = "";
  for await (const chunk of req) { text += chunk; if (text.length > 262_144) throw Error("too_large"); }
  const parsed: unknown = JSON.parse(text || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Error("invalid_body");
  return parsed as Record<string, unknown>;
}
const publicSession = (session: Session) => ({
  sessionId: session.id, expiresAt: new Date(session.expiresAt).toISOString(), status: session.status,
  description: session.description, action: session.action, challengeId: session.challengeId,
  targets: [{ ...session.challenge[0] }],
});
const auth = (req: IncomingMessage): boolean => safeEqual(String(req.headers.authorization ?? ""), `Bearer ${serverSecret}`);
const requestOrigin = (req: IncomingMessage): string | undefined => typeof req.headers.origin === "string" ? req.headers.origin : undefined;
const phoneLease = (req: IncomingMessage): string => String(req.headers["x-phone-lease"] ?? "");
const isDesktop = (req: IncomingMessage, session: Session): boolean => Boolean(session.clientHash && safeEqual(session.clientHash, digest(String(req.headers["x-session-token"] ?? ""))));
const eventPayload = (session: Session) => ({ status: session.status, failures: session.failures, expiresAt: new Date(session.expiresAt).toISOString() });
const publish = (session: Session, event = "status") => {
  const payload = `event: ${event}\ndata: ${JSON.stringify(eventPayload(session))}\n\n`;
  for (const response of streams.get(session.id) ?? []) response.write(payload);
  if (["succeeded", "cancelled", "expired", "consumed"].includes(session.status)) {
    for (const response of streams.get(session.id) ?? []) response.end(); streams.delete(session.id);
  }
};
const serve = async (res: ServerResponse, path: string, contentType: string) => {
  res.writeHead(200, { ...securityHeaders, "content-type": contentType });
  res.end(await readFile(fileURLToPath(new URL(path, import.meta.url))));
};
const limited = (res: ServerResponse, key: string, maximum: number, windowMs = 60_000): boolean => {
  const now = Date.now(), current = rateBuckets.get(key);
  const bucket = !current || now >= current.resetsAt ? { count: 1, resetsAt: now + windowMs } : { ...current, count: current.count + 1 };
  rateBuckets.set(key, bucket);
  if (bucket.count <= maximum) return false;
  res.setHeader("retry-after", String(Math.max(1, Math.ceil((bucket.resetsAt - now) / 1000)))); json(res, 429, { code: "RATE_LIMITED" }); return true;
};

export async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", allowedOrigin);
    if (req.method === "GET" && url.pathname === "/") return serve(res, "./public/index.html", "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/app.js") return serve(res, "./public/app.js", "text/javascript; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/styles.css") return serve(res, "./public/styles.css", "text/css; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/accessibility.css") return serve(res, "./public/accessibility.css", "text/css; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/operator") return serve(res, "./public/operator.html", "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/operator.js") return serve(res, "./public/operator.js", "text/javascript; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/widget.js") return serve(res, "./public/widget.js", "text/javascript; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { status: "ok" });
    if (req.method === "GET" && url.pathname === "/v1/operator/metrics") {
      if (operatorToken && !safeEqual(String(req.headers.authorization ?? ""), `Bearer ${operatorToken}`)) return json(res, 401, { code: "INVALID_REQUEST" });
      return json(res, 200, { ...telemetry.summary(), recent: telemetry.recent() });
    }
    const origin = requestOrigin(req);
    // Browser-facing calls must prove their exact origin. Authenticated merchant
    // server calls do not carry a browser Origin header and are scoped separately.
    const hasSessionCapability = Boolean(req.headers["x-session-token"] || req.headers["x-phone-lease"]);
    if ((!origin || origin !== allowedOrigin) && !auth(req) && !hasSessionCapability) return json(res, 403, { code: "ORIGIN_NOT_ALLOWED" });

    if (req.method === "POST" && url.pathname === "/v1/sessions") {
      if (limited(res, `create:${req.socket.remoteAddress ?? "unknown"}`, 20)) return;
      const input = await body(req);
      if (origin !== allowedOrigin) return json(res, 403, { code: "ORIGIN_NOT_ALLOWED" });
      if (input.siteKey !== publishableKey || !actions.has(String(input.action)) || typeof input.transactionId !== "string" || input.transactionId.length < 1 || input.transactionId.length > 128) return json(res, 400, { code: "INVALID_REQUEST" });
      const sessionToken = opaque();
      const session = store.create({ origin, action: String(input.action), description: typeof input.actionDescription === "string" ? input.actionDescription : undefined, transactionId: input.transactionId, clientToken: sessionToken });
      telemetry.record({ sessionId: session.id, event: "session_started" });
      return json(res, 201, { ...publicSession(session), sessionToken });
    }

    if (req.method === "POST" && url.pathname === "/v1/handoffs/connect") {
      if (limited(res, `connect:${req.socket.remoteAddress ?? "unknown"}`, 30)) return;
      const input = await body(req), session = store.get(String(input.sessionId ?? ""));
      if (!session) return json(res, 410, { code: "SESSION_EXPIRED" });
      try {
        const lease = store.connectPhone(session, String(input.token ?? ""), String(input.phoneId ?? ""));
        telemetry.record({ sessionId: session.id, event: "phone_connected", route: "handoff" }); publish(session, "connected");
        return json(res, 200, { ...publicSession(session), phoneLease: lease });
      } catch { return json(res, 410, { code: "SESSION_EXPIRED" }); }
    }

    const match = url.pathname.match(/^\/v1\/sessions\/([^/]+)(?:\/(attempts|handoff|alternative|alternative-begin|cancel|heartbeat|events))?$/);
    const session = match ? store.get(match[1]!) : undefined;
    if (match && !session) return json(res, 404, { code: "INVALID_REQUEST" });
    if (req.method === "GET" && match && !match[2]) {
      const step = Math.max(0, Math.min(2, Number(url.searchParams.get("step") ?? 0)));
      const isPhone = Boolean(phoneLease(req));
      if (isPhone ? !store.authorizePhone(session!, phoneLease(req)) : !isDesktop(req, session!)) return json(res, 401, { code: isPhone ? "PHONE_DISCONNECTED" : "SESSION_UNAUTHORIZED" });
      return json(res, 200, { ...publicSession(session!), targets: [{ ...session!.challenge[step] }], resultToken: !isPhone && session!.status === "succeeded" ? session!.resultToken : undefined });
    }
    if (req.method === "GET" && match?.[2] === "events") {
      if (!isDesktop(req, session!)) return json(res, 401, { code: "SESSION_UNAUTHORIZED" });
      res.writeHead(200, { ...securityHeaders, "content-type": "text/event-stream", connection: "keep-alive", "x-accel-buffering": "no" });
      res.write(`retry: 1200\nevent: status\ndata: ${JSON.stringify(eventPayload(session!))}\n\n`);
      const listeners = streams.get(session!.id) ?? new Set<ServerResponse>(); listeners.add(res); streams.set(session!.id, listeners);
      const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 10_000);
      req.on("close", () => { clearInterval(heartbeat); listeners.delete(res); if (listeners.size === 0) streams.delete(session!.id); });
      return;
    }
    if (req.method === "POST" && match?.[2] === "heartbeat") {
      try { store.heartbeat(session!, phoneLease(req)); return json(res, 200, { status: session!.status }); }
      catch { return json(res, 401, { code: "PHONE_DISCONNECTED" }); }
    }
    if (req.method === "POST" && match?.[2] === "attempts") {
      if (limited(res, `attempt:${session!.id}`, 12)) return;
      const input = await body(req);
      if (input.invalidate === true) {
        if (session!.phoneId ? !store.authorizePhone(session!, phoneLease(req)) : !isDesktop(req, session!)) return json(res, 401, { code: "SESSION_UNAUTHORIZED" });
        store.freshAttempt(session!); publish(session!, "attempt-reset"); return json(res, 200, { status: session!.status, challengeId: session!.challengeId });
      }
      const method: Method = input.method === "qr" ? "qr_motion" : "direct_motion";
      if (method === "qr_motion" && !store.authorizePhone(session!, phoneLease(req))) return json(res, 401, { code: "PHONE_DISCONNECTED" });
      if (method === "direct_motion" && (!isDesktop(req, session!) || session!.phoneId)) return json(res, 401, { code: "SESSION_UNAUTHORIZED" });
      if (!["pending", "connected", "challenging"].includes(session!.status)) return json(res, 409, { code: "ATTEMPT_REJECTED" });
      session!.status = "challenging";
      const samples = Array.isArray(input.samples) ? input.samples : [];
      const ok = input.challengeId === session!.challengeId && evaluate(session!.challenge, samples as never[], Date.now());
      if (!ok) { session!.failures++; telemetry.record({ sessionId: session!.id, event: "attempt_rejected", route: method === "qr_motion" ? "handoff" : "direct", reason: "invalid_movement" }); store.freshAttempt(session!); publish(session!, "attempt-rejected"); return json(res, 422, { code: "ATTEMPT_REJECTED", failures: session!.failures, challengeId: session!.challengeId }); }
      const resultToken = store.succeed(session!, method);
      telemetry.record({ sessionId: session!.id, event: "verification_completed", route: method === "qr_motion" ? "handoff" : "direct", durationMs: session!.completedAt! - (session!.expiresAt - 120_000) }); publish(session!, "confirmed");
      return json(res, 200, method === "qr_motion" ? { status: "confirmed" } : { status: "confirmed", resultToken });
    }
    if (req.method === "POST" && match?.[2] === "handoff") {
      if (!isDesktop(req, session!)) return json(res, 401, { code: "SESSION_UNAUTHORIZED" });
      try {
        const token = store.issueHandoff(session!);
        telemetry.record({ sessionId: session!.id, event: "handoff_created", route: "handoff" }); publish(session!, "handoff-created");
        const link = `${allowedOrigin}/?handoff=${session!.id}#${token}`;
        return json(res, 200, { link, qr: await QRCode.toDataURL(link), expiresAt: new Date(session!.handoffExpiresAt!).toISOString() });
      } catch { return json(res, 409, { code: "ATTEMPT_REJECTED" }); }
    }
    if (req.method === "POST" && match?.[2] === "alternative") {
      if (!auth(req)) return json(res, 401, { code: "INVALID_REQUEST" });
      const input = await body(req), method: Method = input.method as Method;
      if (method !== "reviewed_accessibility") return json(res, 400, { code: "INVALID_REQUEST" });
      return json(res, 200, { resultToken: store.succeed(session!, method) });
    }
    if (req.method === "POST" && match?.[2] === "alternative-begin") {
      if (!isDesktop(req, session!) && !store.authorizePhone(session!, phoneLease(req))) return json(res, 401, { code: "SESSION_UNAUTHORIZED" });
      const alternativeToken = store.beginAlternative(session!); publish(session!, "route-changed");
      return json(res, 200, { status: "alternative_pending", alternativeToken });
    }
    if (req.method === "POST" && match?.[2] === "cancel") { if (!isDesktop(req, session!)) return json(res, 401, { code: "SESSION_UNAUTHORIZED" }); store.cancel(session!); telemetry.record({ sessionId: session!.id, event: "cancelled" }); publish(session!, "cancelled"); return json(res, 200, { status: session!.status }); }
    if (req.method === "POST" && url.pathname === "/v1/results/redeem") {
      if (!auth(req)) return json(res, 401, { code: "INVALID_REQUEST" });
      const idempotencyKey = req.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string" || !idempotencyKey) return json(res, 400, { code: "IDEMPOTENCY_KEY_REQUIRED" });
      const input = await body(req);
      const result = store.redeem(String(input.resultToken ?? ""), { origin: String(input.origin ?? ""), action: String(input.action ?? ""), transactionId: String(input.transactionId ?? ""), idempotencyKey });
      if ((result as { outcome?: string }).outcome === "valid_consumed") telemetry.record({ event: "result_redeemed" });
      return json(res, 200, result);
    }
    if (req.method === "POST" && url.pathname === "/demo/purchase") {
      if (origin !== allowedOrigin) return json(res, 403, { code: "ORIGIN_NOT_ALLOWED" });
      const input = await body(req), transactionId = String(input.transactionId ?? "");
      const result = store.redeem(String(input.resultToken ?? ""), { origin: allowedOrigin, action: "demo_purchase", transactionId, idempotencyKey: `purchase:${transactionId}` }) as { outcome: string };
      return result.outcome === "valid_consumed" ? json(res, 200, { purchased: true, transactionId }) : json(res, 403, { purchased: false, outcome: result.outcome });
    }
    if (req.method === "POST" && url.pathname === "/demo/alternative") {
      if (origin !== allowedOrigin) return json(res, 403, { code: "ORIGIN_NOT_ALLOWED" });
      if (!demoAlternativeCode) return json(res, 503, { code: "ALTERNATIVE_NOT_CONFIGURED" });
      const input = await body(req), candidate = String(input.code ?? ""), session = store.get(String(input.sessionId ?? ""));
      if (!session || !store.authorizeAlternative(session, String(req.headers["x-alternative-token"] ?? ""))) return json(res, 404, { code: "INVALID_REQUEST" });
      if (!candidate || !safeEqual(candidate, demoAlternativeCode)) {
        session.failures++;
        telemetry.record({ sessionId: session.id, event: "alternative_failed", route: "alternative", reason: "invalid_code" });
        if (session.failures >= 5) store.cancel(session);
        return json(res, 401, { code: "ALTERNATIVE_NOT_VERIFIED" });
      }
      const resultToken = store.succeed(session, "reviewed_accessibility"); telemetry.record({ sessionId: session.id, event: "verification_completed", route: "alternative" }); publish(session, "confirmed");
      return json(res, 200, { resultToken });
    }
    return json(res, 404, { code: "NOT_FOUND" });
  } catch { return json(res, 400, { code: "INVALID_REQUEST" }); }
}

if (process.env.NODE_ENV !== "test") {
  const maintenance = setInterval(() => {
    const now = Date.now(); for (const [key, bucket] of rateBuckets) if (now >= bucket.resetsAt) rateBuckets.delete(key);
    for (const session of store.sessions.values()) {
      const before = session.status; store.get(session.id);
      if (before !== session.status) { telemetry.record({ sessionId: session.id, event: before === "connected" ? "phone_disconnected" : "expired", route: before === "connected" ? "handoff" : undefined }); publish(session, session.status); }
    }
    store.prune();
    telemetry.enforceRetention();
  }, 5_000); maintenance.unref();
  createServer(handler).listen(Number(process.env.PORT ?? 3000), () => console.log("Motion Presence: http://localhost:3000"));
}

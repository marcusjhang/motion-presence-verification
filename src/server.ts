import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { Store, digest, evaluate, opaque, safeEqual, type Method, type Session } from "./core.js";

export const store = new Store();
const serverSecret = process.env.MPV_SERVER_SECRET ?? "local-development-secret";
const publishableKey = "pk_local_demo";
const allowedOrigin = process.env.MPV_ORIGIN ?? "http://localhost:3000";
const actions = new Set(["demo_purchase"]);
const demoAlternativeCode = process.env.MPV_DEMO_ALTERNATIVE_CODE;
const securityHeaders = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "permissions-policy": "accelerometer=(self), gyroscope=(self)" };
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

export async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", allowedOrigin);
    if (req.method === "GET" && url.pathname === "/") { res.writeHead(200, { ...securityHeaders, "content-type": "text/html; charset=utf-8" }); res.end(await readFile(fileURLToPath(new URL("./public/index.html", import.meta.url)))); return; }
    if (req.method === "GET" && url.pathname === "/app.js") { res.writeHead(200, { ...securityHeaders, "content-type": "text/javascript; charset=utf-8" }); res.end(await readFile(fileURLToPath(new URL("./public/app.js", import.meta.url)))); return; }
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { status: "ok" });
    const origin = requestOrigin(req);
    // Browser-facing calls must prove their exact origin. Authenticated merchant
    // server calls do not carry a browser Origin header and are scoped separately.
    const hasSessionCapability = Boolean(req.headers["x-session-token"] || req.headers["x-phone-lease"]);
    if ((!origin || origin !== allowedOrigin) && !auth(req) && !hasSessionCapability) return json(res, 403, { code: "ORIGIN_NOT_ALLOWED" });

    if (req.method === "POST" && url.pathname === "/v1/sessions") {
      const input = await body(req);
      if (origin !== allowedOrigin) return json(res, 403, { code: "ORIGIN_NOT_ALLOWED" });
      if (input.siteKey !== publishableKey || !actions.has(String(input.action)) || typeof input.transactionId !== "string" || input.transactionId.length < 1 || input.transactionId.length > 128) return json(res, 400, { code: "INVALID_REQUEST" });
      const sessionToken = opaque();
      const session = store.create({ origin, action: String(input.action), description: typeof input.actionDescription === "string" ? input.actionDescription : undefined, transactionId: input.transactionId, clientToken: sessionToken });
      return json(res, 201, { ...publicSession(session), sessionToken });
    }

    if (req.method === "POST" && url.pathname === "/v1/handoffs/connect") {
      const input = await body(req), session = store.get(String(input.sessionId ?? ""));
      if (!session) return json(res, 410, { code: "SESSION_EXPIRED" });
      try {
        const lease = store.connectPhone(session, String(input.token ?? ""), String(input.phoneId ?? ""));
        return json(res, 200, { ...publicSession(session), phoneLease: lease });
      } catch { return json(res, 410, { code: "SESSION_EXPIRED" }); }
    }

    const match = url.pathname.match(/^\/v1\/sessions\/([^/]+)(?:\/(attempts|handoff|alternative|cancel|heartbeat))?$/);
    const session = match ? store.get(match[1]!) : undefined;
    if (match && !session) return json(res, 404, { code: "INVALID_REQUEST" });
    if (req.method === "GET" && match && !match[2]) {
      const step = Math.max(0, Math.min(2, Number(url.searchParams.get("step") ?? 0)));
      const isPhone = Boolean(phoneLease(req));
      if (isPhone ? !store.authorizePhone(session!, phoneLease(req)) : !isDesktop(req, session!)) return json(res, 401, { code: isPhone ? "PHONE_DISCONNECTED" : "SESSION_UNAUTHORIZED" });
      return json(res, 200, { ...publicSession(session!), targets: [{ ...session!.challenge[step] }], resultToken: !isPhone && session!.status === "succeeded" ? session!.resultToken : undefined });
    }
    if (req.method === "POST" && match?.[2] === "heartbeat") {
      try { store.heartbeat(session!, phoneLease(req)); return json(res, 200, { status: session!.status }); }
      catch { return json(res, 401, { code: "PHONE_DISCONNECTED" }); }
    }
    if (req.method === "POST" && match?.[2] === "attempts") {
      const input = await body(req);
      if (input.invalidate === true) {
        if (session!.phoneId ? !store.authorizePhone(session!, phoneLease(req)) : !isDesktop(req, session!)) return json(res, 401, { code: "SESSION_UNAUTHORIZED" });
        store.freshAttempt(session!); return json(res, 200, { status: session!.status, challengeId: session!.challengeId });
      }
      const method: Method = input.method === "qr" ? "qr_motion" : "direct_motion";
      if (method === "qr_motion" && !store.authorizePhone(session!, phoneLease(req))) return json(res, 401, { code: "PHONE_DISCONNECTED" });
      if (method === "direct_motion" && (!isDesktop(req, session!) || session!.phoneId)) return json(res, 401, { code: "SESSION_UNAUTHORIZED" });
      if (!["pending", "connected", "challenging"].includes(session!.status)) return json(res, 409, { code: "ATTEMPT_REJECTED" });
      session!.status = "challenging";
      const samples = Array.isArray(input.samples) ? input.samples : [];
      const ok = input.challengeId === session!.challengeId && evaluate(session!.challenge, samples as never[], Date.now());
      if (!ok) { session!.failures++; store.freshAttempt(session!); return json(res, 422, { code: "ATTEMPT_REJECTED", failures: session!.failures, challengeId: session!.challengeId }); }
      const resultToken = store.succeed(session!, method);
      return json(res, 200, method === "qr_motion" ? { status: "confirmed" } : { status: "confirmed", resultToken });
    }
    if (req.method === "POST" && match?.[2] === "handoff") {
      if (!isDesktop(req, session!)) return json(res, 401, { code: "SESSION_UNAUTHORIZED" });
      try {
        const token = store.issueHandoff(session!);
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
    if (req.method === "POST" && match?.[2] === "cancel") { if (!isDesktop(req, session!)) return json(res, 401, { code: "SESSION_UNAUTHORIZED" }); store.cancel(session!); return json(res, 200, { status: session!.status }); }
    if (req.method === "POST" && url.pathname === "/v1/results/redeem") {
      if (!auth(req)) return json(res, 401, { code: "INVALID_REQUEST" });
      const idempotencyKey = req.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string" || !idempotencyKey) return json(res, 400, { code: "IDEMPOTENCY_KEY_REQUIRED" });
      const input = await body(req);
      return json(res, 200, store.redeem(String(input.resultToken ?? ""), { origin: String(input.origin ?? ""), action: String(input.action ?? ""), transactionId: String(input.transactionId ?? ""), idempotencyKey }));
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
      if (!session || session.transactionId !== input.transactionId) return json(res, 404, { code: "INVALID_REQUEST" });
      if (!candidate || !safeEqual(candidate, demoAlternativeCode)) {
        session.failures++;
        if (session.failures >= 5) store.cancel(session);
        return json(res, 401, { code: "ALTERNATIVE_NOT_VERIFIED" });
      }
      return json(res, 200, { resultToken: store.succeed(session, "reviewed_accessibility") });
    }
    return json(res, 404, { code: "NOT_FOUND" });
  } catch { return json(res, 400, { code: "INVALID_REQUEST" }); }
}

if (process.env.NODE_ENV !== "test") createServer(handler).listen(Number(process.env.PORT ?? 3000), () => console.log("Motion Presence demo: http://localhost:3000"));

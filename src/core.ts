import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type Method = "direct_motion" | "qr_motion" | "reviewed_accessibility";
export type Direction = "left" | "right" | "up" | "down" | "center";
export type Status = "pending" | "connected" | "challenging" | "succeeded" | "cancelled" | "expired" | "consumed";
export interface Target { direction: Direction; x: number; y: number }
export interface Sample { t: number; x: number; y: number; visible: boolean; angle: 0 | 90 | 180 | 270 }
export interface Session {
  id: string; origin: string; action: string; description: string; transactionId: string;
  clientHash?: string;
  expiresAt: number; status: Status; challenge: Target[]; challengeId: string; failures: number;
  handoffHash?: string; handoffExpiresAt?: number; phoneId?: string; phoneLeaseHash?: string;
  alternativeHash?: string;
  phoneLeaseExpiresAt?: number; resultHash?: string; resultToken?: string; resultExpiresAt?: number;
  method?: Method; completedAt?: number;
}

const terminal = new Set<Status>(["succeeded", "cancelled", "expired", "consumed"]);
const vectors: Record<Direction, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1], center: [0, 0] };
const secureRandom = (): number => randomBytes(4).readUInt32BE(0) / 0x1_0000_0000;
export const opaque = (bytes = 24): string => randomBytes(bytes).toString("base64url");
export const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
export function challenge(random: () => number = secureRandom): Target[] {
  const dirs: Direction[] = ["left", "right", "up", "down"];
  const first = dirs[Math.floor(random() * dirs.length)]!;
  const remaining = dirs.filter((direction) => direction !== first);
  const second = remaining[Math.floor(random() * remaining.length)]!;
  const sequence: Direction[] = [first, second, "center"];
  return sequence.map((direction) => {
    if (direction === "center") return { direction, x: 0, y: 0 };
    const magnitude = 7 + random() * 2, crossAxis = (random() - .5) * 2;
    const [x, y] = vectors[direction]; return { direction, x: x ? x * magnitude : crossAxis, y: y ? y * magnitude : crossAxis };
  });
}
export function evaluate(targets: readonly Target[], samples: readonly Sample[], now: number): boolean {
  if (samples.length < 6 || samples.length > 1000) return false;
  let index = 0, dwellStart: number | undefined, last = -1;
  const angle = samples[0]!.angle;
  for (const sample of samples) {
    if (!sample.visible || sample.angle !== angle || sample.t <= last || sample.t > now + 1000) return false;
    if (![sample.t, sample.x, sample.y].every(Number.isFinite) || Math.abs(sample.x) > 45 || Math.abs(sample.y) > 45) return false;
    if (last >= 0 && sample.t - last > 1500) return false;
    last = sample.t;
    const target = targets[index];
    if (!target) break;
    if (Math.hypot(sample.x - target.x, sample.y - target.y) <= 3) {
      dwellStart ??= sample.t;
      if (sample.t - dwellStart >= 120) { index++; dwellStart = undefined; }
    } else dwellStart = undefined;
  }
  const duration = samples.at(-1)!.t - samples[0]!.t;
  return index === targets.length && duration >= 360 && duration <= 10_000;
}

export class Store {
  readonly sessions = new Map<string, Session>();
  readonly idempotency = new Map<string, { tokenHash: string; result: unknown; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  create(input: { origin: string; action: string; description?: string; transactionId: string; clientToken?: string }): Session {
    const session: Session = {
      id: opaque(), origin: input.origin, action: input.action, description: input.description ?? input.action,
      transactionId: input.transactionId, clientHash: input.clientToken ? digest(input.clientToken) : undefined,
      expiresAt: this.now() + 120_000, status: "pending",
      challenge: challenge(), challengeId: opaque(), failures: 0,
    };
    this.sessions.set(session.id, session);
    return session;
  }
  get(id: string): Session | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (session.status === "succeeded" && session.resultExpiresAt && this.now() >= session.resultExpiresAt) { session.status = "expired"; session.resultToken = undefined; session.alternativeHash = undefined; this.disconnectPhone(session); }
    if (!terminal.has(session.status) && this.now() >= session.expiresAt) this.expire(session);
    if (session.phoneLeaseExpiresAt && this.now() >= session.phoneLeaseExpiresAt && !terminal.has(session.status)) this.disconnectPhone(session);
    return session;
  }
  assertActive(session: Session): void {
    this.get(session.id);
    if (terminal.has(session.status)) throw new Error("invalid_state");
  }
  freshAttempt(session: Session): void {
    this.assertActive(session);
    session.challenge = challenge(); session.challengeId = opaque();
    session.status = session.phoneId ? "connected" : "pending";
  }
  issueHandoff(session: Session): string {
    this.assertActive(session);
    const token = opaque();
    session.handoffHash = digest(token);
    session.handoffExpiresAt = Math.min(session.expiresAt, this.now() + 120_000);
    this.disconnectPhone(session); this.freshAttempt(session);
    return token;
  }
  connectPhone(session: Session, handoffToken: string, phoneId: string): string {
    this.assertActive(session);
    if (!session.handoffHash || !safeEqual(session.handoffHash, digest(handoffToken)) || !session.handoffExpiresAt || this.now() >= session.handoffExpiresAt) throw new Error("invalid_handoff");
    if (!phoneId || phoneId.length > 128) throw new Error("invalid_phone");
    const lease = opaque();
    session.handoffHash = undefined; session.handoffExpiresAt = undefined;
    session.phoneId = phoneId; session.phoneLeaseHash = digest(lease); session.phoneLeaseExpiresAt = this.now() + 15_000;
    session.status = "connected";
    return lease;
  }
  authorizePhone(session: Session, lease: string): boolean {
    this.get(session.id);
    return Boolean(session.phoneLeaseHash && session.phoneLeaseExpiresAt && this.now() < session.phoneLeaseExpiresAt && safeEqual(session.phoneLeaseHash, digest(lease)));
  }
  heartbeat(session: Session, lease: string): void {
    this.assertActive(session);
    if (!this.authorizePhone(session, lease)) throw new Error("invalid_lease");
    session.phoneLeaseExpiresAt = this.now() + 15_000;
  }
  disconnectPhone(session: Session): void {
    session.phoneId = undefined; session.phoneLeaseHash = undefined; session.phoneLeaseExpiresAt = undefined;
    if (!terminal.has(session.status)) session.status = "pending";
  }
  beginAlternative(session: Session): string {
    this.assertActive(session); const token = opaque();
    session.alternativeHash = digest(token); session.handoffHash = undefined; this.disconnectPhone(session); this.freshAttempt(session);
    return token;
  }
  authorizeAlternative(session: Session, token: string): boolean { return Boolean(session.alternativeHash && safeEqual(session.alternativeHash, digest(token))); }
  succeed(session: Session, method: Method): string {
    this.assertActive(session);
    const token = opaque();
    session.status = "succeeded"; session.method = method; session.resultHash = digest(token); session.resultToken = token;
    session.completedAt = this.now(); session.resultExpiresAt = this.now() + 300_000; session.handoffHash = undefined; session.alternativeHash = undefined;
    this.disconnectPhone(session);
    return token;
  }
  cancel(session: Session): void {
    if (terminal.has(session.status)) return;
    session.status = "cancelled"; session.handoffHash = undefined; session.alternativeHash = undefined; this.disconnectPhone(session);
  }
  private expire(session: Session): void {
    session.status = "expired"; session.handoffHash = undefined; session.alternativeHash = undefined; this.disconnectPhone(session);
  }
  prune(): void {
    const now = this.now();
    for (const [id, session] of this.sessions) {
      this.get(id); const terminalAt = session.resultExpiresAt ?? session.expiresAt;
      if (terminal.has(session.status) && now >= terminalAt + 600_000) this.sessions.delete(id);
    }
    for (const [scope, record] of this.idempotency) if (now >= record.expiresAt) this.idempotency.delete(scope);
  }
  redeem(token: string, input: { origin: string; action: string; transactionId: string; idempotencyKey: string }): unknown {
    if (!input.idempotencyKey || input.idempotencyKey.length > 128) return { outcome: "invalid_request" };
    const tokenHash = digest(token || "");
    const scope = digest(`${input.origin}\0${input.action}\0${input.transactionId}\0${input.idempotencyKey}`);
    const prior = this.idempotency.get(scope);
    if (prior && this.now() < prior.expiresAt) return safeEqual(prior.tokenHash, tokenHash) ? prior.result : { outcome: "idempotency_conflict" };
    if (prior) this.idempotency.delete(scope);
    const session = [...this.sessions.values()].find((item) => item.resultHash === tokenHash);
    let result: unknown;
    if (!session) result = { outcome: "invalid" };
    else if (session.status === "consumed") result = { outcome: "already_consumed" };
    else if (!session.resultExpiresAt || this.now() >= session.resultExpiresAt) { session.status = "expired"; result = { outcome: "expired" }; }
    else if (session.status === "cancelled") result = { outcome: "cancelled" };
    else if (session.origin !== input.origin) result = { outcome: "wrong_site" };
    else if (session.action !== input.action || session.transactionId !== input.transactionId) result = { outcome: "wrong_action" };
    else {
      session.status = "consumed"; session.resultToken = undefined;
      result = { outcome: "valid_consumed", action: session.action, transactionId: session.transactionId, method: session.method, completedAt: new Date(session.completedAt!).toISOString() };
      this.idempotency.set(scope, { tokenHash, result, expiresAt: this.now() + 600_000 });
    }
    return result;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

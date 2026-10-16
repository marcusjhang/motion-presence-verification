import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHmac, randomBytes } from "node:crypto";

export type EventName =
  | "session_started" | "direct_started" | "handoff_created" | "phone_connected"
  | "attempt_rejected" | "verification_completed" | "result_redeemed"
  | "alternative_failed" | "cancelled" | "expired" | "phone_disconnected";

interface AuditInput {
  sessionId?: string;
  event: EventName;
  route?: "direct" | "handoff" | "alternative";
  reason?: string;
  durationMs?: number;
}

interface MetricRow { event: string; route: string | null; count: number; averageMs: number | null }

export class Telemetry {
  private readonly database: DatabaseSync;
  private readonly correlationKey = randomBytes(32);

  constructor(path = process.env.MPV_DATABASE_PATH ?? resolve(".data/motion-presence.sqlite")) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_hash TEXT,
        event TEXT NOT NULL,
        route TEXT,
        reason TEXT,
        duration_ms INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_created_at ON audit_events(created_at);
    `);
  }

  record(input: AuditInput): void {
    this.database.prepare("INSERT INTO audit_events(session_hash,event,route,reason,duration_ms,created_at) VALUES(?,?,?,?,?,?)")
      .run(input.sessionId ? this.hashId(input.sessionId) : null, input.event, input.route ?? null, input.reason ?? null, input.durationMs ?? null, Date.now());
  }

  summary(windowMs = 86_400_000): { windowMs: number; generatedAt: string; totals: MetricRow[] } {
    const since = Date.now() - Math.max(60_000, Math.min(windowMs, 90 * 86_400_000));
    const rows = this.database.prepare(`
      SELECT event, route, COUNT(*) AS count,
        CASE WHEN COUNT(duration_ms) > 0 THEN CAST(AVG(duration_ms) AS INTEGER) ELSE NULL END AS averageMs
      FROM audit_events WHERE created_at >= ? GROUP BY event, route ORDER BY event, route
    `).all(since) as unknown as MetricRow[];
    return { windowMs, generatedAt: new Date().toISOString(), totals: rows };
  }

  recent(limit = 30): Array<{ event: string; route: string | null; reason: string | null; createdAt: string }> {
    const rows = this.database.prepare("SELECT event,route,reason,created_at FROM audit_events ORDER BY id DESC LIMIT ?").all(Math.max(1, Math.min(limit, 100))) as unknown as Array<{ event: string; route: string | null; reason: string | null; created_at: number }>;
    return rows.map(({ event, route, reason, created_at }) => ({ event, route, reason, createdAt: new Date(created_at).toISOString() }));
  }

  enforceRetention(now = Date.now()): number {
    const result = this.database.prepare("DELETE FROM audit_events WHERE created_at < ?").run(now - 30 * 86_400_000);
    return Number(result.changes);
  }

  close(): void { this.database.close(); }

  private hashId(value: string): string {
    // Session hashes only correlate events inside this service; raw identifiers and
    // all motion samples, handoff tokens, result tokens, and secrets never enter telemetry.
    return createHmac("sha256", this.correlationKey).update(value).digest("base64url").slice(0, 16);
  }
}

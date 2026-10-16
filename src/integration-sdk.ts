export type RedemptionOutcome =
  | { outcome: "valid_consumed"; action: string; transactionId: string; method: string; completedAt: string }
  | { outcome: "expired" | "already_consumed" | "wrong_site" | "wrong_action" | "cancelled" | "invalid" | "invalid_request" | "idempotency_conflict" };

export interface MotionPresenceClientOptions {
  baseUrl: string;
  serverSecret: string;
  origin: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export class MotionPresenceError extends Error {
  constructor(public readonly code: "timeout" | "unavailable" | "unauthorized" | "invalid_response", message: string) { super(message); this.name = "MotionPresenceError"; }
}

export class MotionPresenceClient {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: MotionPresenceClientOptions) {
    if (!options.baseUrl || !options.serverSecret || !options.origin) throw new TypeError("baseUrl, serverSecret, and origin are required");
    this.fetcher = options.fetch ?? globalThis.fetch; this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async redeem(input: { resultToken: string; action: string; transactionId: string; idempotencyKey: string }): Promise<RedemptionOutcome> {
    if (!input.resultToken || !input.action || !input.transactionId || !input.idempotencyKey) throw new TypeError("All redemption fields are required");
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(new URL("/v1/results/redeem", this.options.baseUrl), {
        method: "POST", signal: controller.signal,
        headers: { authorization: `Bearer ${this.options.serverSecret}`, "content-type": "application/json", "idempotency-key": input.idempotencyKey },
        body: JSON.stringify({ resultToken: input.resultToken, action: input.action, transactionId: input.transactionId, origin: this.options.origin }),
      });
      if (response.status === 401) throw new MotionPresenceError("unauthorized", "Verification service authentication failed");
      if (!response.ok) throw new MotionPresenceError("unavailable", `Verification service returned ${response.status}`);
      const result = await response.json() as { outcome?: unknown };
      if (typeof result.outcome !== "string") throw new MotionPresenceError("invalid_response", "Verification service returned an invalid response");
      return result as RedemptionOutcome;
    } catch (error) {
      if (error instanceof MotionPresenceError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new MotionPresenceError("timeout", "Verification service request timed out");
      throw new MotionPresenceError("unavailable", "Verification service is unavailable");
    } finally { clearTimeout(timeout); }
  }
}

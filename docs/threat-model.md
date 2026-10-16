# Threat model

## Protected boundary

The merchant creates a scoped session and completes its action only after its trusted backend atomically redeems an opaque result. Desktop, phone, and result capabilities are separate. Origin, action, transaction, expiry, terminal state, and idempotency are checked server-side.

## Defended threats

- Replayed, expired, cancelled, wrong-origin, wrong-action, and already-consumed results
- Reuse or replacement of a QR bearer
- A phone attempting to retrieve the desktop result
- Two methods racing to complete one session
- Missing idempotency, oversized bodies, rapid attempts, and repeated support-code guessing
- Bearers leaking through QR request paths or referrers; the bearer remains in the URL fragment and is cleared before connection
- Secrets and raw motion entering telemetry

## Explicit limitations

A modified browser can synthesize orientation events or call the protocol directly. Virtual sensors, rooted devices, instrumented browsers, real-device farms, human relays, and physical robots can satisfy or emulate movement. The product therefore verifies a fresh interaction, not personhood, intent, or trusted hardware provenance. Higher-assurance actions must combine it with account authentication, passkeys, transaction risk, or reviewed recovery.

## Operational assumptions

Production uses TLS 1.2 or newer, rotatable secrets, a trusted reverse-proxy allowlist, shared atomic session storage, encrypted durable records, bounded retention, and monitored rate limits. Outages fail closed and never mint successful results.

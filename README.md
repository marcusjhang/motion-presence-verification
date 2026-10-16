# Motion Presence Verification

A complete local product experience for confirming a fresh physical interaction before a sensitive action. Visitors can gently tilt a motion-capable laptop or phone, hand off from a computer to a phone with a one-time QR link, or use a merchant-controlled motion-independent route.

The security claim is intentionally narrow: this confirms satisfaction of a fresh challenge. It does not prove humanity or that readings came from unmodified physical hardware.

## Run the product

Requires Node.js 22 or newer.

```sh
npm install
npx playwright install chromium
MPV_DEMO_ALTERNATIVE_CODE=246810 npm start
```

Open <http://localhost:3000> for the checkout and verification experience. Open <http://localhost:3000/operator> for privacy-safe aggregate activity. The demo support code is `246810` only when set explicitly as shown; the route is disabled otherwise.

To scan the QR code with a physical phone, set `MPV_ORIGIN` to an HTTPS address that reaches this service from the phone. Motion APIs generally require a secure context; plain LAN HTTP is not a reliable physical-device test environment.

```sh
npm test
npm run typecheck
npm run build
npm run test:e2e
```

## What is implemented

- Direct motion permission, fresh-reading probe, calibration, three-target challenge, retry, interruption, and neutral failure recovery
- One-time QR handoff, phone ownership lease, heartbeat, replacement revocation, server-authored status events, and desktop completion
- Merchant-controlled motion-independent verification with brute-force limits
- Opaque, origin/action/transaction-bound results with five-minute expiry, atomic single use, and scoped idempotency
- A reusable `<motion-presence>` custom element and typed backend redemption client
- Durable SQLite aggregate telemetry, retention support, and a local operator view with no raw motion or bearer credentials
- Request limits, body limits, origin checks, capability separation, security headers, and fail-closed behavior
- Responsive checkout and verification interfaces with keyboard, focus, reduced-motion, and automated accessibility coverage

See [integration documentation](docs/integration.md), [privacy and retention](docs/privacy-and-retention.md), [threat model](docs/threat-model.md), and [compatibility notes](docs/compatibility.md).

## Deployment boundary

The included service is a complete single-node product and reference integration suitable for local evaluation and controlled pilots. A horizontally scaled hosted deployment must replace the in-memory live session repository and event fan-out with shared atomic infrastructure such as Redis, provision managed durable storage, terminate TLS, rotate customer secrets, and complete the physical-device and operational acceptance gates in the implementation plan.

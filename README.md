# Motion Presence Verification MVP

This is a local, runnable implementation of the product spec. It provides one
Node service for the verification API, widget, phone handoff, and demo merchant.
State is deliberately in memory for the MVP; restarting the process invalidates
all sessions and results.

## Run

Requires Node 22+.

```sh
npm install
npm test
npm run typecheck
npm run test:e2e
npm start
```

Open <http://localhost:3000>. The motion-independent alternative requires a
merchant-controlled one-time support code (`MPV_DEMO_ALTERNATIVE_CODE`) and is
disabled when that variable is absent, so a browser callback alone cannot
authorize the action. To scan the QR code on a physical phone,
set `MPV_ORIGIN` to an HTTPS origin reachable by that phone (device-motion APIs
generally require a secure context).

## Security and privacy boundary

The service verifies satisfaction of a fresh interaction; it does **not** prove
humanity or attest that sensor data came from physical hardware. Modified
browsers, virtual sensors, relays, device farms, and challenge-aware automation
remain in scope as limitations. Protected actions occur only after server-side,
origin/action/transaction-bound, atomic single-use redemption. QR bearer data is
placed in the URL fragment, cleared before connection, and stored only as a
SHA-256 digest. Raw motion samples are evaluated in request memory and are not
logged or persisted. Sessions and QR links expire after at most 120 seconds.
Successful result tokens have a separate five-minute lifetime beginning at
completion.

Production deployment would require durable atomic storage, customer key
management, rate limiting, TLS, retention jobs, and completed physical-device,
accessibility, load, and security audits described in the implementation plan.
Those empirical gates are intentionally not claimed by this local MVP.

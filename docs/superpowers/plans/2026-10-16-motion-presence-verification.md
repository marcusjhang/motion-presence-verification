# Motion Presence Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-testable CAPTCHA alternative in which every protected action requires a short motion challenge on the current motion-capable device or through a one-time QR phone handoff, followed by backend-only redemption of a short-lived single-use result.

**Architecture:** Use a TypeScript monorepo with a framework-neutral Web Component widget, a Fastify verification API, PostgreSQL for durable customer/configuration/audit records, and Redis for short-lived sessions, handoff coordination, rate limits, and atomic redemption. Motion challenges are generated server-side, rendered by the widget, evaluated against signed attempt payloads, and completed through an opaque browser result that must be redeemed by the customer's backend. Server-Sent Events synchronize desktop handoff state; the phone submits through ordinary HTTPS so reconnection remains simple.

**Tech Stack:** Node.js 22 LTS, TypeScript 5.x strict mode, pnpm workspaces, Fastify, PostgreSQL 17, Drizzle ORM, Redis 7, Web Components with Lit, Zod, JOSE, Vitest, Playwright, axe-core, Docker Compose, OpenAPI 3.1, GitHub Actions.

**Spec:** `specs/motion-presence-verification/PRODUCT.md`

## Global Constraints

- Every protected action receives explicit verification; no risk-score or previous-history silent pass exists.
- Direct motion is attempted on phones, tablets, convertibles, and laptops only after fresh sensor readings are confirmed.
- Phone handoff is always available when direct motion is unsafe, unavailable, denied, or unwanted.
- No challenge requires shaking, sudden acceleration, a full rotation, an exact physical angle, or movement beyond a small comfortable range.
- QR sessions expire after 120 seconds; successful results expire after 300 seconds and are redeemable exactly once.
- A browser success callback never authorizes an action; only atomic backend redemption does.
- Raw motion readings are deleted immediately after the attempt is accepted or rejected and never enter ordinary logs or analytics.
- The widget never claims to prove humanity; standard copy uses “Quick physical check” and “Confirmed.”
- Motion-independent alternatives remain visible before permission, during the challenge, after failure, and throughout QR handoff.
- Production verification fails closed: an outage never creates or validates a successful result.
- All externally supplied identifiers are opaque, random, non-sequential, and validated against the customer origin and action.
- All code uses strict TypeScript, explicit return types on exported functions, UTC timestamps, and structured logs with secret-field redaction.

---

## Planned Repository Layout

```text
apps/
  api/                         Fastify HTTP/SSE API and production entrypoint
  demo-merchant/               Reference integration and Playwright test host
packages/
  contracts/                   Zod schemas, public types, OpenAPI generation
  domain/                      Session state machine and policy-free domain rules
  persistence/                 PostgreSQL/Redis adapters and atomic scripts
  challenge-engine/            Challenge generation, normalization, evaluation
  widget/                      Framework-neutral <motion-presence> component
  integration-sdk/             Customer backend client and token verification API
  test-kit/                    Deterministic fixtures and production-safe test mode
infra/
  docker-compose.yml           Local PostgreSQL and Redis
  migrations/                  Versioned SQL migrations
  dashboards/                  Metrics and alert definitions
docs/
  integration.md               Customer integration guide
  operations.md                Deployment, rollback, retention, and incident runbook
  threat-model.md              Trust boundaries and documented non-guarantees
tests/
  e2e/                         Browser, QR handoff, accessibility, race tests
  security/                    Replay, origin, expiry, concurrency, and abuse tests
```

## Delivery Phases and Exit Gates

0. **Feasibility:** physical-device coverage, movement comfort, QR fallback time, and virtual-sensor attacks are measured before committing to the production architecture.
1. **Foundation:** contracts, state machine, persistence, and local infrastructure pass unit and migration tests.
2. **Secure verification core:** challenge evaluation plus single-use redemption passes replay, race, wrong-origin, wrong-action, and expiry tests.
3. **Direct-device experience:** supported mobile and sensor-capable desktop browsers complete the direct flow; unsupported devices reach handoff or alternatives without dead ends.
4. **QR handoff:** desktop and phone remain synchronized across connect, complete, disconnect, refresh, replace, expire, and concurrent-scan cases.
5. **Accessibility and integration:** keyboard, screen-reader, reduced-motion, zoom, localization, fallback, and reference backend flows pass automated and manual checks.
6. **Hardening and pilot:** observability, retention deletion, rate limiting, load testing, failure drills, compatibility matrix, and pilot acceptance thresholds are verified.

---

## Canonical Cross-Package Interfaces

Implement these signatures in Task 2 and change them only through a reviewed contract migration. Later tasks must import these definitions rather than redeclare lookalikes.

```ts
export type SessionId = string & { readonly __brand: "SessionId" };
export type AttemptId = string & { readonly __brand: "AttemptId" };
export type ResultToken = string & { readonly __brand: "ResultToken" };
export type CustomerId = string & { readonly __brand: "CustomerId" };

export type CompletionMethod =
  | "direct_motion"
  | "qr_motion"
  | "passkey"
  | "email_link"
  | "authenticated_account"
  | "reviewed_accessibility";

export interface CreateSessionRequest {
  siteKey: string;
  action: string;
  actionDescription?: string;
  transactionId: string;
}

export interface CreateSessionResponse {
  sessionId: SessionId;
  expiresAt: string;
  status: "created";
}

export interface MotionSample {
  sequence: number;
  clientTimeMs: number;
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  acceleration: { x: number | null; y: number | null; z: number | null };
  rotationRate: { alpha: number | null; beta: number | null; gamma: number | null };
  screenAngle: 0 | 90 | 180 | 270;
  visibility: "visible" | "hidden";
}

export interface SubmitAttemptRequest {
  attemptId: AttemptId;
  challengeId: string;
  samples: readonly MotionSample[];
}

export type RedeemResultResponse =
  | { outcome: "valid_consumed"; customerId: CustomerId; action: string; transactionId: string; method: CompletionMethod; completedAt: string }
  | { outcome: "expired" | "already_consumed" | "wrong_site" | "wrong_action" | "cancelled" | "invalid" };

export interface MotionPresenceClient {
  redeem(input: {
    resultToken: ResultToken;
    action: string;
    transactionId: string;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<RedeemResultResponse>;
}
```

The authoritative session state union is:

```ts
export type SessionStatus =
  | "created"
  | "awaiting_device"
  | "device_connected"
  | "calibrating"
  | "challenging"
  | "evaluating"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired"
  | "consumed";
```

---

### Task 0: Prove interaction feasibility and document the security ceiling

**Files:**
- Create: `experiments/sensor-lab/index.html`
- Create: `experiments/sensor-lab/recorder.ts`
- Create: `experiments/sensor-lab/challenge.ts`
- Create: `experiments/sensor-lab/virtual-solver.ts`
- Create: `experiments/sensor-lab/results-template.csv`
- Create: `docs/feasibility-report.md`

**Interfaces:**
- Produces: disposable browser prototype, anonymized compatibility/usability measurements, reproducible virtual-sensor attack, and a written go/no-go decision. No experiment code becomes production code without being rewritten under later tasks and tests.

- [ ] **Step 1: Build a local HTTPS sensor probe** that requests permission after a click, reports whether fresh non-null motion events arrive, displays sampling rate and screen orientation, and automatically deletes captured readings when the page closes.
- [ ] **Step 2: Build a throwaway two-target-plus-center challenge** using normalized tilt, a three-to-five-second target, and a phone-handoff timing mock; label it “research prototype—not security verification.”
- [ ] **Step 3: Test at least 10 phones/tablets** spanning recent iOS Safari, Android Chrome, Samsung Internet, iPadOS Safari, low-cost Android hardware, and an embedded webview; record permission behavior, sensor availability, sample rate, calibration time, challenge time, retries, and comfort.
- [ ] **Step 4: Test at least 10 computers** spanning macOS laptops, Windows laptops, Windows convertibles, ChromeOS convertibles, Linux laptops, and external-monitor desktop setups; record whether a public browser API delivers usable readings and route every failure through the QR mock.
- [ ] **Step 5: Include at least 12 people in the interaction study**, including at least four with a motor, tremor, low-vision, motion-sensitivity, mounted-device, or screen-reader-related access need; collect comprehension, comfort, completion, failure, and preferred-alternative feedback without retaining raw traces.
- [ ] **Step 6: Implement a Chrome DevTools Protocol virtual-sensor solver** that reads each displayed target and injects a generated motion curve; measure the effort, latency, and success rate and preserve the script as a permanent regression attack.
- [ ] **Step 7: Test replay and naive automation attacks** using a recorded trace, fixed-value sensors, instantaneous jumps, reordered samples, time-scaled samples, and a generic browser script that does not understand target semantics.
- [ ] **Step 8: Write `docs/feasibility-report.md`** with the raw aggregate results, device matrix, accessibility findings, attack results, and the explicit conclusion that web sensor data is not hardware-attested and a challenge-aware solver can synthesize it.
- [ ] **Step 9: Apply go/no-go gates**: at least 90% direct completion among devices that deliver usable readings; median direct completion under 7 seconds; median QR mock completion under 20 seconds; no unresolved unsafe-movement finding; every unsupported computer reaches phone handoff within 3 seconds; and the team accepts that the product adds friction against generic automation but cannot claim resistance to a challenge-aware virtual-sensor attacker.
- [ ] **Step 10: Stop or redesign before Task 1** if any usability/safety gate fails or if stakeholders require proof of humanity or hardware-originated motion. Continue only with the documented, narrower security claim approved in the feasibility report.
- [ ] **Step 11: Commit** with `git commit -m "research: validate motion verification feasibility"`.

---

### Task 1: Bootstrap the monorepo and reproducible local environment

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `eslint.config.js`
- Create: `infra/docker-compose.yml`
- Create: `.github/workflows/ci.yml`
- Create: `.gitignore`
- Test: `tests/smoke/workspace.test.ts`

**Interfaces:**
- Produces: workspace scripts `lint`, `typecheck`, `test`, `test:e2e`, `build`, `dev:infra`; PostgreSQL at `localhost:5432`; Redis at `localhost:6379`.

- [ ] **Step 1: Write the workspace smoke test** that asserts each required package manifest exists and exposes `build`, `typecheck`, and `test` scripts.
- [ ] **Step 2: Run `pnpm vitest run tests/smoke/workspace.test.ts`** and verify it fails because the workspace packages do not exist.
- [ ] **Step 3: Create the root manifests and package directories** with Node 22 pinned in `engines`, `packageManager`, strict TypeScript settings, and no implicit dependency hoisting.
- [ ] **Step 4: Add Docker Compose services** using `postgres:17-alpine` and `redis:7-alpine`, named health checks, persistent development volumes, and explicit non-production credentials.
- [ ] **Step 5: Add CI jobs** for install, lint, typecheck, unit tests, build, migration verification, and Playwright installation; cache only the pnpm store.
- [ ] **Step 6: Run `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build`** and verify every command succeeds from a clean checkout.
- [ ] **Step 7: Commit** with `git commit -m "chore: bootstrap motion verification workspace"`.

### Task 2: Define public contracts and generate OpenAPI

**Files:**
- Create: `packages/contracts/src/ids.ts`
- Create: `packages/contracts/src/sessions.ts`
- Create: `packages/contracts/src/results.ts`
- Create: `packages/contracts/src/errors.ts`
- Create: `packages/contracts/src/events.ts`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/scripts/generate-openapi.ts`
- Test: `packages/contracts/src/contracts.test.ts`

**Interfaces:**
- Produces: branded `SessionId`, `AttemptId`, `ResultToken`, `CustomerId`; `CreateSessionRequest`; `CreateSessionResponse`; `SubmitAttemptRequest`; `RedeemResultRequest`; `RedeemResultResponse`; `SessionEvent`; `PublicError`; generated `openapi.json`.

- [ ] **Step 1: Write failing schema tests** for valid creation, invalid origins, unknown actions, overlong transaction IDs, malformed traces, every redemption outcome, and event discriminators.
- [ ] **Step 2: Run `pnpm --filter @motion/contracts test`** and verify failures identify missing exported schemas.
- [ ] **Step 3: Implement branded ID schemas** as URL-safe 128-bit-or-greater opaque values and reject empty, sequential-looking, or oversized identifiers at public boundaries.
- [ ] **Step 4: Implement request and response schemas** with explicit maximum sizes: action name 64 characters, display description 160 characters, transaction ID 128 characters, trace 1,000 samples, and request body 256 KiB.
- [ ] **Step 5: Implement stable error codes** including `INVALID_REQUEST`, `ORIGIN_NOT_ALLOWED`, `ACTION_NOT_ALLOWED`, `SESSION_EXPIRED`, `SESSION_CANCELLED`, `ATTEMPT_REJECTED`, `RESULT_EXPIRED`, `RESULT_USED`, `RESULT_SCOPE_MISMATCH`, `RATE_LIMITED`, and `SERVICE_UNAVAILABLE`.
- [ ] **Step 6: Generate OpenAPI 3.1** from the same Zod contracts and add a test that fails when generated output differs from committed `openapi.json`.
- [ ] **Step 7: Run tests, typecheck, and generation drift check** and verify clean output.
- [ ] **Step 8: Commit** with `git commit -m "feat: define verification service contracts"`.

### Task 3: Implement the authoritative session state machine

**Files:**
- Create: `packages/domain/src/session-state.ts`
- Create: `packages/domain/src/session-command.ts`
- Create: `packages/domain/src/session-event.ts`
- Create: `packages/domain/src/session-machine.ts`
- Test: `packages/domain/src/session-machine.test.ts`

**Interfaces:**
- Consumes: IDs and event types from `@motion/contracts`.
- Produces: `reduceSession(state, command, now): TransitionResult`; states `created`, `awaiting_device`, `device_connected`, `calibrating`, `challenging`, `evaluating`, `succeeded`, `failed`, `cancelled`, `expired`, `consumed`.

- [ ] **Step 1: Write a table-driven failing test** covering every legal transition and proving illegal transitions return `INVALID_STATE` without mutation.
- [ ] **Step 2: Add race tests** for success versus cancellation, success versus expiry, duplicate success, phone replacement, and redemption versus expiry at identical timestamps.
- [ ] **Step 3: Implement immutable state types and command discriminated unions** with terminal-state guards.
- [ ] **Step 4: Implement `reduceSession`** so server receipt ordering plus version comparison yields exactly one authoritative terminal outcome.
- [ ] **Step 5: Add property tests** asserting terminal states never transition back, version increases exactly once per accepted command, and consumption occurs at most once.
- [ ] **Step 6: Run `pnpm --filter @motion/domain test`** and verify all transition and property tests pass.
- [ ] **Step 7: Commit** with `git commit -m "feat: add verification session state machine"`.

### Task 4: Add PostgreSQL and Redis persistence with atomic operations

**Files:**
- Create: `infra/migrations/0001_customers_actions_audit.sql`
- Create: `packages/persistence/src/postgres/schema.ts`
- Create: `packages/persistence/src/customer-repository.ts`
- Create: `packages/persistence/src/session-repository.ts`
- Create: `packages/persistence/src/lua/transition-session.lua`
- Create: `packages/persistence/src/lua/redeem-result.lua`
- Test: `packages/persistence/src/persistence.integration.test.ts`

**Interfaces:**
- Produces: `CustomerRepository`; `SessionRepository.create`; `SessionRepository.get`; `SessionRepository.transition`; `SessionRepository.consumeResult`; compare-and-set semantics using session version.

- [ ] **Step 1: Write integration tests** against real PostgreSQL and Redis for customer origin/action lookup, session TTL, atomic transition, cancellation, and exactly-one-winner redemption under 50 concurrent requests.
- [ ] **Step 2: Run the integration tests** and verify failure due to missing repositories and migrations.
- [ ] **Step 3: Create durable tables** for customers, allowed origins, protected actions, configuration revisions, retention policies, and security audit records; do not create a raw-motion table.
- [ ] **Step 4: Implement Redis keys** with namespaced customer/session IDs and explicit TTLs for session, challenge, handoff lease, connection event stream, result, and rate-limit counters.
- [ ] **Step 5: Implement Lua transition and redemption scripts** that compare version, verify state/scope/expiry, write the next state, and consume a result atomically.
- [ ] **Step 6: Add migration rollback verification** using a disposable database and confirm applying migrations twice is safe.
- [ ] **Step 7: Run concurrency tests repeatedly** and verify exactly one redemption returns `valid_consumed` while all others return `result_used`.
- [ ] **Step 8: Commit** with `git commit -m "feat: persist sessions with atomic redemption"`.

### Task 5: Build deterministic challenge generation

**Files:**
- Create: `packages/challenge-engine/src/challenge.ts`
- Create: `packages/challenge-engine/src/generator.ts`
- Create: `packages/challenge-engine/src/constraints.ts`
- Create: `packages/challenge-engine/src/commitment.ts`
- Test: `packages/challenge-engine/src/generator.test.ts`

**Interfaces:**
- Produces: `generateChallenge(random, profile): Challenge`; `commitChallenge(challenge, secret): string`; profiles `phone`, `tablet`, `laptop`.

- [ ] **Step 1: Write failing tests** that require two directional targets plus center, bounded tilt magnitudes, no adjacent duplicate directions, laptop-safe limits, and deterministic output under seeded test randomness.
- [ ] **Step 2: Add distribution tests** over 100,000 generated challenges to detect unreachable, biased, repeated, or out-of-bounds sequences.
- [ ] **Step 3: Implement the challenge model** with normalized target vectors, tolerance radius, dwell duration, attempt deadline, and random per-attempt challenge ID.
- [ ] **Step 4: Implement cryptographically secure production generation** while dependency-injecting randomness for deterministic tests.
- [ ] **Step 5: Implement a keyed commitment** so stored session data can prove which challenge was issued without exposing future target order to the widget before each target becomes active.
- [ ] **Step 6: Run unit and distribution tests** and inspect failure output for bias.
- [ ] **Step 7: Commit** with `git commit -m "feat: generate bounded motion challenges"`.

### Task 6: Normalize and evaluate motion traces

**Files:**
- Create: `packages/challenge-engine/src/sample.ts`
- Create: `packages/challenge-engine/src/calibration.ts`
- Create: `packages/challenge-engine/src/normalize.ts`
- Create: `packages/challenge-engine/src/evaluate.ts`
- Create: `packages/challenge-engine/src/reasons.ts`
- Test: `packages/challenge-engine/src/evaluate.test.ts`
- Test: `packages/challenge-engine/fixtures/*.json`

**Interfaces:**
- Produces: `calibrate(samples): CalibrationResult`; `normalizeTrace(samples, calibration, orientation): NormalizedTrace`; `evaluateTrace(challenge, trace): EvaluationResult` with coarse public reasons and detailed internal diagnostics.

- [ ] **Step 1: Create synthetic fixtures** for normal completion, slow completion, tremor, overshoot, sensor noise, wrong order, flat constant values, impossible discontinuity, screen rotation, background pause, replayed timestamps, and timeout.
- [ ] **Step 2: Write failing evaluator tests** defining acceptance bands for every fixture and ensuring public rejection reasons do not reveal target thresholds.
- [ ] **Step 3: Implement calibration** using a stable rolling window and reject null, stale, non-monotonic, or insufficient samples.
- [ ] **Step 4: Implement orientation-independent normalization** relative to the calibrated pose and current screen orientation.
- [ ] **Step 5: Implement ordered target evaluation** using distance, dwell time, velocity continuity, total duration, sample cadence, and pause visibility markers; keep all numeric thresholds in versioned challenge profiles.
- [ ] **Step 6: Add differential tests** that perturb accepted traces with noise, time scaling, and overshoot while preserving acceptance, and mutate order or timestamps while preserving rejection.
- [ ] **Step 7: Add raw-data lifecycle tests** proving the evaluator returns only derived diagnostics and no repository or logger receives the original samples.
- [ ] **Step 8: Run the complete challenge-engine suite** and document fixture provenance in `packages/challenge-engine/fixtures/README.md`.
- [ ] **Step 9: Commit** with `git commit -m "feat: evaluate calibrated motion traces"`.

### Task 7: Implement the verification HTTP API

**Files:**
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/routes/sessions.ts`
- Create: `apps/api/src/routes/attempts.ts`
- Create: `apps/api/src/routes/results.ts`
- Create: `apps/api/src/routes/cancel.ts`
- Create: `apps/api/src/plugins/auth.ts`
- Create: `apps/api/src/plugins/origin.ts`
- Create: `apps/api/src/plugins/errors.ts`
- Test: `apps/api/src/api.integration.test.ts`

**Interfaces:**
- Produces: `POST /v1/sessions`; `POST /v1/sessions/:id/attempts`; `POST /v1/sessions/:id/cancel`; `POST /v1/results/redeem`; health endpoints separate from verification endpoints.

- [ ] **Step 1: Write failing API tests** from `openapi.json` for valid and invalid creation, Origin enforcement, action allowlist, body limits, idempotency keys, attempt submission, cancellation, and every redemption outcome.
- [ ] **Step 2: Add a test** proving a browser cannot call redemption with the public widget key and a customer backend cannot create a browser session without a permitted Origin.
- [ ] **Step 3: Implement customer authentication** with separate publishable widget keys and rotatable server secrets; hash stored server secrets and redact both key types from logs.
- [ ] **Step 4: Implement session creation** binding customer, exact normalized origin, action, opaque customer transaction ID, configuration revision, issuance time, and 120-second session expiry.
- [ ] **Step 5: Implement attempt submission** with request-size enforcement, state transition to evaluating, challenge evaluation, raw-reference release in a `finally` block, and coarse client response.
- [ ] **Step 6: Implement result redemption** using the atomic repository operation, returning a stable redemption outcome and bound transaction metadata.
- [ ] **Step 7: Implement cancellation and health endpoints** without allowing health success to imply verification availability.
- [ ] **Step 8: Run contract, API, origin, and concurrency tests** and verify the API never returns an authorizing result without atomic persistence.
- [ ] **Step 9: Commit** with `git commit -m "feat: expose secure verification API"`.

### Task 8: Build the widget shell and customer integration lifecycle

**Files:**
- Create: `packages/widget/src/motion-presence.ts`
- Create: `packages/widget/src/controller.ts`
- Create: `packages/widget/src/api-client.ts`
- Create: `packages/widget/src/state.ts`
- Create: `packages/widget/src/copy/en.ts`
- Create: `packages/widget/src/styles.ts`
- Test: `packages/widget/src/widget.test.ts`

**Interfaces:**
- Produces: `<motion-presence site-key action action-description>`; methods `start(): Promise<VerificationHandle>` and `cancel(): void`; events `motion-presence-status` and `motion-presence-complete` where completion contains only an opaque result token.

- [ ] **Step 1: Write failing component tests** for initial, loading, cancelled, network-error, expired, and confirmed states plus attribute validation and duplicate `start()` calls.
- [ ] **Step 2: Define a closed widget state union** matching user-visible states from PRODUCT invariants 1–8, 44–48, and 89–95.
- [ ] **Step 3: Implement the Web Component shell** with Shadow DOM, CSP-compatible styles, semantic headings, labeled controls, and no inline executable code.
- [ ] **Step 4: Implement controller cancellation** using `AbortController` so route changes, dialog closure, and integrator cancellation stop requests and invalidate the session.
- [ ] **Step 5: Implement completion dispatch** so the browser receives only the result token and never a server secret, raw challenge answer, or authority to perform the protected action.
- [ ] **Step 6: Add framework examples** for plain HTML, React, Vue, and server-rendered pages without creating separate framework implementations.
- [ ] **Step 7: Run component tests in Chromium, Firefox, and WebKit** and verify identical state semantics.
- [ ] **Step 8: Commit** with `git commit -m "feat: add embeddable verification widget shell"`.

### Task 9: Implement sensor capability detection and permission handling

**Files:**
- Create: `packages/widget/src/sensors/types.ts`
- Create: `packages/widget/src/sensors/device-motion-adapter.ts`
- Create: `packages/widget/src/sensors/generic-sensor-adapter.ts`
- Create: `packages/widget/src/sensors/capability.ts`
- Create: `packages/widget/src/views/explanation.ts`
- Create: `packages/widget/src/views/permission-error.ts`
- Test: `packages/widget/src/sensors/capability.test.ts`

**Interfaces:**
- Produces: `MotionAdapter`; `detectMotionCapability(signal): Promise<CapabilityResult>`; `requestMotionPermission(): Promise<PermissionResult>`; normalized `MotionSample` stream.

- [ ] **Step 1: Write failing tests** for absent APIs, present-but-null APIs, delayed readings, denied permission, dismissed permission, policy restriction, stale events, embedded webview failure, and successful readings.
- [ ] **Step 2: Implement adapter feature detection** without treating interface presence as hardware availability.
- [ ] **Step 3: Implement permission requests** only after the Start click and normalize browsers that require no explicit prompt.
- [ ] **Step 4: Implement the fresh-reading probe** with a finite two-second deadline, monotonic timestamp validation, and cleanup of every event listener on completion or cancellation.
- [ ] **Step 5: Implement route selection**: direct flow for usable readings, handoff for unavailable readings, and an inconclusive choice screen when results cannot be established.
- [ ] **Step 6: Add browser-specific recovery copy** without repeatedly triggering permission prompts after denial.
- [ ] **Step 7: Run mocked unit tests plus physical-device exploratory tests** and record verified browser/device combinations in `docs/compatibility.md`.
- [ ] **Step 8: Commit** with `git commit -m "feat: detect and request usable motion sensors"`.

### Task 10: Build calibration and the direct movement experience

**Files:**
- Create: `packages/widget/src/motion/calibration-controller.ts`
- Create: `packages/widget/src/motion/challenge-controller.ts`
- Create: `packages/widget/src/views/calibration.ts`
- Create: `packages/widget/src/views/challenge.ts`
- Create: `packages/widget/src/views/success.ts`
- Create: `packages/widget/src/views/retry.ts`
- Test: `packages/widget/src/motion/direct-flow.test.ts`

**Interfaces:**
- Consumes: `MotionAdapter`, challenge contract, widget controller.
- Produces: calibrated trace submission; visual target state; retry decisions; completion event only after server acceptance.

- [ ] **Step 1: Write failing tests** for stable calibration, unstable calibration, five-second calibration failure, screen rotation, target progress, tremor, timeout, visibility loss, cancellation, and three-attempt escalation.
- [ ] **Step 2: Implement calibration control** with rolling stability feedback and automatic restart after orientation change.
- [ ] **Step 3: Implement target rendering** with marker and target shapes distinguishable without color, textual progress, and no preview of future targets.
- [ ] **Step 4: Implement sample capture** with bounded memory, a maximum 1,000 samples, visibility markers, monotonic timestamps, and immediate buffer release after submission resolves.
- [ ] **Step 5: Implement subtle haptics** only when supported and not disabled, with visual feedback always present.
- [ ] **Step 6: Implement timeout and retry** with a fresh server challenge on every attempt and alternative/handoff recommendations after three failures.
- [ ] **Step 7: Add reduced-motion behavior** that removes decorative transitions while preserving the positional feedback required to perform the task.
- [ ] **Step 8: Run component and simulated-sensor tests** including Chrome DevTools virtual sensors; verify known synthetic traces cannot bypass order, timing, and replay checks.
- [ ] **Step 9: Commit** with `git commit -m "feat: add direct motion challenge experience"`.

### Task 11: Implement QR handoff and cross-device synchronization

**Files:**
- Create: `apps/api/src/routes/handoff.ts`
- Create: `apps/api/src/routes/session-events.ts`
- Create: `packages/domain/src/handoff.ts`
- Create: `packages/widget/src/handoff/qr.ts`
- Create: `packages/widget/src/handoff/sse-client.ts`
- Create: `packages/widget/src/views/handoff-desktop.ts`
- Create: `packages/widget/src/views/handoff-phone.ts`
- Test: `tests/e2e/qr-handoff.spec.ts`

**Interfaces:**
- Produces: `POST /v1/sessions/:id/handoff`; `POST /v1/handoffs/:token/connect`; `GET /v1/sessions/:id/events`; single active phone lease; 120-second handoff TTL.

- [ ] **Step 1: Write an end-to-end failing test** that creates a desktop session, renders a QR URL, connects a phone context, completes motion, receives server-confirmed desktop success, and redeems exactly once.
- [ ] **Step 2: Add failing cases** for second-phone conflict, expired QR, regenerated QR, desktop cancellation, phone disconnection, desktop refresh, and late completion after expiry.
- [ ] **Step 3: Implement one-time handoff creation** using a random token whose stored representation is hashed and whose URL reveals no sensitive transaction data.
- [ ] **Step 4: Implement the active-phone lease** with compare-and-set ownership and explicit conflict responses; never silently replace a connected phone.
- [ ] **Step 5: Implement SSE synchronization** with event IDs, heartbeat, bounded replay from the session event stream, automatic reconnect, and terminal-state closure.
- [ ] **Step 6: Implement QR rendering and short-link fallback** with origin/action copy visible on both devices.
- [ ] **Step 7: Implement QR regeneration** that atomically invalidates the previous handoff and publishes disconnection to any attached phone.
- [ ] **Step 8: Run the full handoff suite** under latency, dropped connection, and reordered-event simulation.
- [ ] **Step 9: Commit** with `git commit -m "feat: add secure QR phone handoff"`.

### Task 12: Add explicit accessible alternative integration

**Files:**
- Create: `packages/contracts/src/alternatives.ts`
- Create: `apps/api/src/routes/alternatives.ts`
- Create: `packages/widget/src/views/alternative-picker.ts`
- Create: `packages/integration-sdk/src/alternatives.ts`
- Test: `tests/e2e/alternatives.spec.ts`

**Interfaces:**
- Produces: registered alternative descriptors; `beginAlternative(sessionId, method)`; `completeAlternative(serverSecret, sessionId, method, evidenceRef)`; widget picker and integrator redirect/callback hooks.

- [ ] **Step 1: Write failing tests** for passkey, email-link, authenticated-account, custom reviewed method, missing configuration, disabled method, concurrent motion completion, and late callback.
- [ ] **Step 2: Implement customer-registered alternatives** with display labels, assurance category, redirect/callback URLs, and origin restrictions.
- [ ] **Step 3: Implement selection** so choosing an alternative cancels the active motion attempt or handoff lease before redirecting.
- [ ] **Step 4: Implement server-only completion** requiring customer authentication and atomic transition to succeeded; browser callbacks alone cannot complete a session.
- [ ] **Step 5: Implement the accessible picker** with keyboard navigation, screen-reader descriptions, visible focus, and no unavailable choices.
- [ ] **Step 6: Add a support-path state** when no method is configured, making the integration error visible in test and customer analytics.
- [ ] **Step 7: Run race and accessibility tests** and verify at most one method wins.
- [ ] **Step 8: Commit** with `git commit -m "feat: integrate accessible verification alternatives"`.

### Task 13: Add backend integration SDK and reference merchant

**Files:**
- Create: `packages/integration-sdk/src/client.ts`
- Create: `packages/integration-sdk/src/errors.ts`
- Create: `packages/integration-sdk/src/index.ts`
- Create: `apps/demo-merchant/src/server.ts`
- Create: `apps/demo-merchant/src/public/index.html`
- Create: `apps/demo-merchant/src/store.ts`
- Test: `apps/demo-merchant/src/integration.test.ts`
- Create: `docs/integration.md`

**Interfaces:**
- Produces: `MotionPresenceClient.redeem({resultToken, action, transactionId, idempotencyKey})`; typed outcomes; demo protected signup and purchase endpoints.

- [ ] **Step 1: Write failing SDK tests** for valid redemption, timeout, invalid authentication, scope mismatch, already-used result, idempotent customer retry, and unavailable service.
- [ ] **Step 2: Implement the server-only SDK** with mandatory base URL, server secret, request timeout, idempotency key, structured typed outcomes, and automatic secret redaction.
- [ ] **Step 3: Build the demo merchant** so the browser requests verification but only the backend redeems and commits the pending signup or purchase.
- [ ] **Step 4: Make the demo protected action idempotent** using the customer transaction ID so a network retry cannot create duplicate orders.
- [ ] **Step 5: Write the integration guide** with exact HTML, JavaScript, backend TypeScript, CSP, allowed-origin setup, action registration, error handling, and local test-mode examples.
- [ ] **Step 6: Add a negative integration example** that demonstrates why trusting `motion-presence-complete` without redemption is insecure and ensure documentation labels it forbidden.
- [ ] **Step 7: Run demo integration tests** and manually verify the normal, expired, duplicate, and service-unavailable experiences.
- [ ] **Step 8: Commit** with `git commit -m "feat: add backend SDK and reference integration"`.

### Task 14: Implement abuse controls and security boundaries

**Files:**
- Create: `apps/api/src/plugins/rate-limit.ts`
- Create: `apps/api/src/plugins/security-headers.ts`
- Create: `packages/domain/src/abuse-policy.ts`
- Create: `tests/security/origin-and-replay.test.ts`
- Create: `tests/security/rate-limit.test.ts`
- Create: `docs/threat-model.md`

**Interfaces:**
- Produces: layered limits by customer, IP prefix, session, transaction ID, and handoff token; explicit `RATE_LIMITED` responses; documented trust boundaries.

- [ ] **Step 1: Write failing security tests** for replay, stolen result token on another action, wrong Origin, spoofed forwarded IP, rapid session creation, repeated failed traces, handoff scanning floods, body decompression bombs, and log injection.
- [ ] **Step 2: Implement trusted-proxy handling** with an explicit deployment allowlist; ignore forwarded headers from untrusted peers.
- [ ] **Step 3: Implement layered token-bucket limits** with customer-configurable ceilings bounded by service-wide safety maxima and `Retry-After` responses.
- [ ] **Step 4: Add security headers and request constraints** including CSP guidance for the widget, strict content types, body limits, no MIME sniffing, TLS 1.2 or newer, HSTS on hosted surfaces, `Referrer-Policy: no-referrer` on handoff pages, and encryption at rest for durable security records.
- [ ] **Step 5: Move the handoff bearer into the QR URL fragment** so it is not sent in the initial HTTP request or referrer; have first-party mobile JavaScript exchange it through `POST /v1/handoffs/connect`, immediately clear the fragment with `history.replaceState`, and test that access logs, browser history, and third-party resource requests contain no bearer.
- [ ] **Step 6: Document the threat model** covering virtual sensors, modified browsers, real-device farms, human relay, physical robots, malicious integrators, result theft, denial of service, and the explicit non-guarantee of humanity.
- [ ] **Step 7: Run OWASP dependency audit and the security suite** with redacted structured-log assertions.
- [ ] **Step 8: Commit** with `git commit -m "feat: harden verification abuse boundaries"`.

### Task 15: Add privacy-safe telemetry and automatic retention enforcement

**Files:**
- Create: `apps/api/src/telemetry/metrics.ts`
- Create: `apps/api/src/telemetry/audit.ts`
- Create: `apps/api/src/telemetry/redaction.ts`
- Create: `apps/api/src/jobs/retention.ts`
- Create: `infra/dashboards/verification.json`
- Test: `apps/api/src/telemetry/privacy.test.ts`
- Create: `docs/privacy-and-retention.md`

**Interfaces:**
- Produces: aggregate counters/histograms by customer and route; coarse failure dimensions; retention job; no raw trace export.

- [ ] **Step 1: Write a failing privacy test** that recursively inspects logs, metrics, audit rows, thrown errors, and persisted records for raw samples, handoff secrets, result tokens, server secrets, and stable cross-customer visitor IDs.
- [ ] **Step 2: Implement centralized redaction** before any structured log or audit sink receives fields.
- [ ] **Step 3: Implement metrics** for starts, routes, permissions, calibration, retries, completion, alternatives, handoffs, abandonment, validation outcomes, and duration without per-visitor labels.
- [ ] **Step 4: Implement exact retention**: raw samples released after evaluation; Redis sessions/results removed by TTL; derived attempt diagnostics retained 7 days; security audit records 30 days; customer aggregate metrics 90 days, all configurable only downward for privacy-sensitive customers.
- [ ] **Step 5: Implement and test the retention job** against records on both sides of every cutoff and verify deletion is idempotent.
- [ ] **Step 6: Add dashboards and alerts** for API errors, completion drops, sensor-compatibility regressions, high retry rates, SSE disconnects, redemption races, Redis latency, and retention failures.
- [ ] **Step 7: Document collected fields and retention periods** in customer- and visitor-readable language.
- [ ] **Step 8: Commit** with `git commit -m "feat: add privacy-safe verification telemetry"`.

### Task 16: Build deterministic test mode without weakening production

**Files:**
- Create: `packages/test-kit/src/fixtures.ts`
- Create: `packages/test-kit/src/test-client.ts`
- Create: `apps/api/src/plugins/test-mode.ts`
- Test: `packages/test-kit/src/test-mode.test.ts`

**Interfaces:**
- Produces: sandbox-only scenarios `success`, `rejected`, `expired`, `used`, `permission_denied`, `sensor_missing`, `handoff_disconnected`, and `alternative_success`.

- [ ] **Step 1: Write failing tests** proving deterministic scenarios work only for sandbox customer keys on a sandbox deployment and cannot be activated by headers, query parameters, or production keys.
- [ ] **Step 2: Implement signed sandbox scenario tokens** issued by the test client and verified only when both deployment and customer are sandbox-scoped.
- [ ] **Step 3: Implement deterministic session clocks and challenge randomness** for repeatable integration tests.
- [ ] **Step 4: Add a build-time production assertion** that sandbox signing keys and scenario routes are absent from the production bundle.
- [ ] **Step 5: Run negative production-mode tests** and inspect the built artifact for forbidden sandbox symbols and secrets.
- [ ] **Step 6: Commit** with `git commit -m "test: add isolated verification sandbox mode"`.

### Task 17: Complete accessibility, localization, and responsive verification

**Files:**
- Create: `packages/widget/src/a11y/announcer.ts`
- Create: `packages/widget/src/a11y/focus.ts`
- Create: `packages/widget/src/i18n/catalog.ts`
- Create: `packages/widget/src/i18n/en.json`
- Test: `tests/e2e/accessibility.spec.ts`
- Test: `tests/e2e/responsive.spec.ts`

**Interfaces:**
- Produces: localized copy catalog, controlled status announcements, focus restoration, 320px-to-desktop responsive UI, 200% zoom support.

- [ ] **Step 1: Write failing axe and keyboard tests** for every widget state, modal focus containment, focus restoration, escape/cancel behavior, alternative availability, and status announcement frequency.
- [ ] **Step 2: Implement focus management** that moves focus to the verification heading on open, never steals focus on every sensor update, and restores focus to the initiating control on close.
- [ ] **Step 3: Implement polite announcements** for major transitions only: permission result, calibration result, target completion count, timeout, connection, success, and error.
- [ ] **Step 4: Extract every visible string** into an ICU-compatible catalog and add a pseudo-locale with 40% expansion and bidirectional markers.
- [ ] **Step 5: Test at 320px, 400% text scaling where supported, 200% browser zoom, portrait, landscape, forced colors, dark mode, and reduced motion.**
- [ ] **Step 6: Conduct manual checks** with VoiceOver/Safari, TalkBack/Chrome, NVDA/Firefox, keyboard-only desktop, switch-style sequential navigation, and a mounted-device alternative flow; record results in `docs/accessibility-audit.md`.
- [ ] **Step 7: Fix every serious or critical audit finding and rerun automated tests** until none remain.
- [ ] **Step 8: Commit** with `git commit -m "feat: complete accessible localized verification UX"`.

### Task 18: Create the cross-browser and physical-device test matrix

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/direct-motion.spec.ts`
- Create: `tests/e2e/lifecycle.spec.ts`
- Create: `tests/e2e/network-failure.spec.ts`
- Create: `tests/e2e/concurrency.spec.ts`
- Create: `docs/compatibility.md`

**Interfaces:**
- Produces: automated Chromium/Firefox/WebKit coverage plus a repeatable physical-device acceptance protocol.

- [ ] **Step 1: Configure isolated Playwright projects** for desktop Chromium, Firefox, WebKit, Android-sized Chromium, and iPhone-sized WebKit with video and trace retained only on failure.
- [ ] **Step 2: Implement virtual-sensor tests** for calibration, successful target order, wrong order, timeout, orientation change, visibility loss, and permission denial.
- [ ] **Step 3: Implement lifecycle tests** for reload, back, duplicate tabs, multiple widgets, cancellation, expiry boundaries, and action-scope mismatch.
- [ ] **Step 4: Implement network tests** for offline creation, dropped submission, delayed acceptance, SSE reconnect, duplicate event delivery, and outage fail-closed behavior.
- [ ] **Step 5: Implement concurrency tests** that repeat redemption and terminal-state races 1,000 times and assert no duplicate protected action occurs in the demo merchant.
- [ ] **Step 6: Define the physical matrix** with current iOS Safari, Android Chrome, Samsung Internet, iPadOS Safari, Windows convertible Chrome/Edge, ChromeOS convertible, motion-capable laptop browsers, and sensorless Windows/macOS desktops using QR handoff.
- [ ] **Step 7: Record per-device results** for sensor availability, permission UX, calibration time, completion time, retry rate, QR scan, rotation, and fallback; do not mark a browser supported without a passing physical run.
- [ ] **Step 8: Commit** with `git commit -m "test: add verification compatibility matrix"`.

### Task 19: Load, resilience, deployment, and incident readiness

**Files:**
- Create: `tests/load/session-lifecycle.js`
- Create: `infra/Dockerfile.api`
- Create: `infra/kubernetes/api.yaml`
- Create: `infra/kubernetes/worker.yaml`
- Create: `docs/operations.md`
- Create: `docs/incident-response.md`

**Interfaces:**
- Produces: immutable API image, horizontally scalable stateless API, retention worker, readiness/liveness behavior, runbooks.

- [ ] **Step 1: Write load scenarios** for 100 session creations per second, 50 attempt submissions per second, 10,000 concurrent QR SSE connections, 50 phone completions per second, and 100 redemptions per second, plus a five-minute burst at five times each request rate and 25,000 SSE connections.
- [ ] **Step 2: Establish explicit pilot service objectives**: p95 session creation under 300 ms, p95 attempt acceptance under 500 ms excluding client capture, p95 desktop handoff update under 1 second, and zero duplicate redemptions.
- [ ] **Step 3: Build a non-root read-only container** with a pinned base image, production-only dependencies, startup migration check, and graceful shutdown that stops new sessions before draining in-flight requests.
- [ ] **Step 4: Configure readiness** to fail when Redis atomic operations or required PostgreSQL reads are unavailable; keep liveness independent enough to avoid restart loops during dependency outages.
- [ ] **Step 5: Run fault injection** for Redis latency, Redis failover, PostgreSQL unavailability, process termination, clock skew, packet loss, and SSE proxy buffering.
- [ ] **Step 6: Write runbooks** for elevated rejection, sensor regression, redemption errors, handoff disconnects, suspected token leakage, retention failure, key rotation, rollback, and full shutdown.
- [ ] **Step 7: Verify restoration** from backups for durable configuration and audit data while confirming expired ephemeral sessions are not restored.
- [ ] **Step 8: Commit** with `git commit -m "ops: prepare verification service for pilot"`.

### Task 20: Run the product acceptance pilot and release gate

**Files:**
- Create: `docs/pilot-protocol.md`
- Create: `docs/release-checklist.md`
- Create: `docs/known-limitations.md`
- Modify: `specs/motion-presence-verification/PRODUCT.md`

**Interfaces:**
- Produces: evidence-backed release decision, reconciled shipped behavior, and published limitations.

- [ ] **Step 1: Recruit at least 80 pilot participants** with at least 20 completing direct phone/tablet flow, 20 completing direct convertible or motion-capable laptop flow, 20 completing desktop QR handoff, and 20 completing a motion-independent alternative. Ensure the total sample includes older devices and participants with low vision, motor disability, tremor, screen-reader use, reduced-motion preference, and mounted devices; obtain appropriate consent for usability data.
- [ ] **Step 2: Run direct and QR workflows** using realistic protected actions and record completion, time, retry, abandonment, permission denial, fallback use, comprehension, comfort, and reported safety issues.
- [ ] **Step 3: Apply release thresholds**: at least 95% eventual completion with an available supported route, median direct challenge under 7 seconds from Start to confirmation, median QR flow under 20 seconds, no serious accessibility blocker, no unsafe movement report left unresolved, and zero successful replay or duplicate-redemption test.
- [ ] **Step 4: Classify every failure** as product defect, browser limitation, device limitation, integration defect, unclear instruction, accessibility barrier, or expected adversarial rejection; do not collapse failures into a “bot” category.
- [ ] **Step 5: Fix all release-blocking findings**, add regression tests for each defect, and rerun the affected pilot scenario and full automated suite.
- [ ] **Step 6: Reconcile `PRODUCT.md`** against actual shipped behavior, updating any invariant that intentionally changed and rejecting any implementation that violates an unchanged invariant.
- [ ] **Step 7: Complete the release checklist** covering contracts, migrations, key rotation, origin registration, rate limits, retention, dashboards, alerts, support escalation, accessibility audit, compatibility, load targets, rollback, privacy notice, and incident contacts.
- [ ] **Step 8: Publish known limitations** including virtual-sensor simulation, relay attacks, device farms, unsupported sensors, browser permission constraints, and the fact that successful completion is not proof of biological humanity.
- [ ] **Step 9: Run final commands**: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, migration verification, security suite, privacy scan, and load smoke test; attach outputs to the release record.
- [ ] **Step 10: Commit** with `git commit -m "docs: complete motion verification release gate"`.

---

## Final Acceptance Checklist

- [ ] All 117 PRODUCT behavior invariants map to at least one implementation task and passing test or recorded manual verification.
- [ ] Direct motion works on every browser/device listed as supported; unsupported devices reach QR handoff or an explicit alternative.
- [ ] A motion-capable laptop is offered direct tilt with visible phone and alternative choices; a sensorless laptop is never left waiting for motion events.
- [ ] QR handoff survives expected reconnects and rejects second-phone takeover, reuse, replacement, expiry, and late completion.
- [ ] Exactly one concurrent redemption can succeed and the demo protected action executes at most once.
- [ ] Wrong origin, action, customer, transaction, expiry, cancellation, and already-used results never authorize an action.
- [ ] Browser callbacks, test-mode parameters, and visual success states cannot bypass backend redemption.
- [ ] Raw motion samples appear in no database table, log, metric, audit row, exception, analytics event, or customer response.
- [ ] Every visible widget state is keyboard accessible, screen-reader coherent, responsive, localized, and usable with reduced motion.
- [ ] No serious or critical accessibility, security, privacy, data-retention, or safety issue remains open.
- [ ] Production outage behavior is fail-closed and clearly distinguishable from successful verification.
- [ ] Pilot thresholds are met or the feature remains unreleased with documented blockers.

## PRODUCT Invariant Coverage Matrix

| PRODUCT invariants | Primary implementation tasks | Proof required |
|---|---|---|
| 1–8 | 7, 8, 13, 18 | Protected-action integration tests and cancellation/workflow tests |
| 9–16 | 9, 10, 18 | Capability unit tests plus physical compatibility runs |
| 17–23 | 9, 17, 18 | Permission-state browser tests and accessible recovery checks |
| 24–29 | 6, 10, 18 | Calibration fixtures, timeout tests, and physical runs |
| 30–43 | 5, 6, 10, 14, 18 | Generator distribution, evaluator, retry, spoofing, and safety tests |
| 44–48 | 4, 7, 8, 13, 18 | Server acceptance, backend redemption, and action idempotency tests |
| 49–63 | 4, 11, 14, 18 | QR lifecycle, bearer-leak, connection, conflict, expiry, and replay tests |
| 64–72 | 12, 17, 20 | Alternative-method races, automated accessibility, and manual audit |
| 73–81 | 2, 4, 7, 13, 14, 18 | Contract, atomic redemption, scoping, and integration tests |
| 82–88 | 3, 4, 7, 11, 18 | State-machine properties, concurrent race, tab, and lifecycle tests |
| 89–95 | 7, 8, 11, 18, 19 | Network simulation, outage behavior, and dependency fault injection |
| 96–102 | 6, 11, 14, 15 | Data-flow inspection, retention tests, bearer-leak tests, privacy scan |
| 103–110 | 2, 7, 8, 13, 15, 16 | Configuration, observability, SDK, and isolated sandbox tests |
| 111–117 | 9, 10, 17, 18, 20 | Copy review, safety checks, responsive/localization tests, compatibility and release reconciliation |

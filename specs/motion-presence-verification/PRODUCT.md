# Motion Presence Verification

## Summary

Motion Presence Verification is a CAPTCHA alternative that asks every visitor completing a protected action to perform a short, freshly generated physical movement. The visitor completes the challenge on their current phone, tablet, or motion-capable laptop; when that device cannot provide motion data, the visitor scans a one-time QR code and completes the same challenge on a phone. A successful challenge yields a short-lived, single-use verification result that the integrating website must validate before performing the protected action.

## Problem

Traditional visual CAPTCHAs are frustrating, create accessibility barriers, and are increasingly solvable by automated vision systems. Websites still need an explicit, understandable verification step that raises the cost of automated abuse without relying on distorted text or image-labeling puzzles. This product verifies completion of a live physical interaction; it does not promise proof of biological humanity or benign intent.

## Goals

- Give every visitor to a protected action an explicit live-presence challenge; there is no silent risk-score bypass.
- Let visitors use the device already in their hands whenever it exposes suitable motion data.
- Provide a seamless QR handoff to a phone when the current computer cannot complete the movement challenge.
- Make the normal challenge brief, safe, understandable, forgiving, and reusable across websites.
- Give integrating websites an unambiguous verification result that is scoped to the intended site and action, expires quickly, and cannot be reused.
- Provide explicit accessible alternatives rather than trapping visitors who cannot use motion controls.
- Communicate accurately: success means the physical challenge was satisfied, not that humanity was proven with certainty.

## Non-goals

- Perfectly distinguishing humans from all software, robots, malware, relays, or paid human solvers.
- Silently approving low-risk visitors without interaction.
- Requiring a native mobile application in the first release.
- Asking visitors to shake devices, perform full rotations, lift unsafe equipment, or match precise physical angles.
- Providing a universal identity, proof-of-personhood, account-reputation, or fraud-scoring system.
- Defining the integrating website's complete fallback authentication system.
- Retaining raw motion traces as a cross-site fingerprint or building cross-customer visitor profiles.

## Figma

Figma: none provided. Conceptual mobile and desktop flows were reviewed through the browser-based design companion.

## Behavior

### Protection boundary and initiation

1. An integrating website explicitly identifies each protected action. Examples include creating an account, submitting a form, placing an order, casting a vote, requesting account recovery, or claiming a scarce resource.

2. Every attempt to complete a protected action requires a successful verification unless the same website has explicitly defined the action as part of an already verified workflow under invariant 8. The product never silently bypasses the verification because a visitor appears low risk.

3. Starting verification does not itself perform the protected action. The action remains pending until the integrating website validates and consumes a successful verification result.

4. The visitor sees verification only after expressing intent to perform the protected action, not unexpectedly during passive browsing.

5. The verification interface identifies the website and, where supplied by the website, the human-readable action being confirmed, such as “Confirm signup on example.com” or “Confirm ticket purchase on example.com.”

6. The interface never claims “You are human,” “You are a bot,” or equivalent. Its standard framing is “Quick physical check” and its success framing is “Confirmed.”

7. The integrating website may cancel a pending protected action at any time. Cancellation closes the verification experience and makes any unfinished challenge unusable.

8. A website may define a protected workflow containing multiple UI steps and require one verification for the workflow rather than one per control. The workflow definition must be clear to the visitor, must not extend beyond the configured validity period, and must not authorize unrelated actions.

### Capability detection and route selection

9. The product first determines whether the current device and browser can provide usable motion or orientation readings. Merely exposing a JavaScript API is not sufficient; the product must confirm that fresh, non-null readings arrive after any required permission is granted.

10. A phone, tablet, convertible computer, or laptop with usable motion data is offered the direct-device flow by default.

11. A desktop or laptop without usable motion data is offered the QR phone-handoff flow by default.

12. A laptop with usable motion data may complete the direct-device flow. The instructions say to tilt the device only when doing so is safe and comfortable, and the visitor can switch to phone handoff before or during the challenge.

13. Capability detection must not require the visitor to lift or move the device before the product explains why movement is requested.

14. If capability detection remains inconclusive, the interface offers both “Try on this device” and “Use my phone.” It does not present an indefinite loading state.

15. The visitor may choose phone handoff even when direct motion is available.

16. The visitor may choose an accessible alternative from the initial explanation screen without first attempting or failing a motion challenge.

### Explanation and permission

17. Before requesting motion permission, the direct-device flow explains what will happen, how long it normally takes, and that only gentle movement is required.

18. The initial direct-device screen provides three visible choices: start the physical check, use a phone instead when applicable, and use another verification method.

19. Browser or operating-system motion permission is requested only in response to the visitor selecting Start or an equivalent explicit control.

20. If permission is granted, the product confirms that readings are usable and proceeds to calibration.

21. If permission is denied, dismissed, restricted by policy, or unavailable, the product explains that motion access is unavailable and presents retry instructions, phone handoff, and the accessible alternative as applicable.

22. The product does not repeatedly trigger the browser permission prompt after a denial. “Try again” provides browser-specific guidance when the visitor must change a setting manually.

23. The product does not request camera, microphone, location, contacts, or unrelated permissions for the direct-device challenge.

### Calibration

24. Calibration begins only after fresh motion readings are available.

25. Calibration asks the visitor to hold the device in any comfortable, stable starting position. It does not require the device to be perfectly flat, vertical, or aligned with magnetic north.

26. Calibration normally completes automatically within one second and provides visible progress.

27. If the device is moving too much to calibrate, the interface asks the visitor to hold it still momentarily and continues when readings stabilize.

28. If calibration cannot complete within five seconds, the visitor can retry, switch to phone handoff, or choose another verification method.

29. Rotating the screen or changing browser orientation during calibration restarts calibration with a clear, non-error message.

### Movement challenge

30. A challenge consists of a freshly generated sequence of at least two movement targets relative to the calibrated starting position, followed by a return toward center. The sequence is not reused across simultaneous or subsequent sessions.

31. The visitor controls an on-screen marker by gently tilting the device. A clearly distinguishable target indicates the required destination.

32. Reaching a target gives immediate visual confirmation and, when supported and enabled, subtle haptic feedback. The next target appears only after the current target is accepted.

33. A normal challenge is designed to complete in approximately three to five seconds after calibration.

34. Required movement remains within a small, safe range. No challenge requires shaking, sudden acceleration, a full device rotation, lifting a desktop computer, moving through an exact angle, or moving the visitor's body.

35. The challenge tolerates ordinary hand tremor, sensor noise, differences in device sensitivity, mild overshoot, and reasonable variation in reaction time.

36. The marker and target are distinguishable without relying on color alone. Instructions and success feedback are available visually; essential information is not haptic-only or audio-only.

37. The active challenge displays concise instructions and progress, such as “Target 1 of 3,” without exposing the entire future movement sequence in advance.

38. The visitor may cancel, switch to phone handoff, or choose another verification method during the active challenge. Leaving the challenge invalidates the unfinished attempt.

39. The visitor may pause before a challenge starts. Once active movement begins, losing page visibility, locking the device, switching applications, or changing screen orientation pauses or invalidates the attempt and requires a fresh sequence after returning.

40. The active challenge has a generous per-attempt time limit. At ten seconds without completion, the product explains that the attempt timed out and offers a fresh retry rather than treating the visitor as malicious.

41. Incorrect, reversed, or incomplete movement receives neutral guidance such as “Let’s try that again” or “Move a little more slowly.” The product never accuses the visitor of being automated.

42. Each retry receives a fresh movement sequence. The visitor cannot replay the previous trace to satisfy the retry.

43. After three failed or timed-out attempts in one verification session, the interface recommends phone handoff or another verification method. The website may permit additional attempts under its configured abuse policy, but the visitor is never trapped in an automatic retry loop.

### Direct-device success

44. On successful completion, the interface immediately displays “Confirmed,” provides visual confirmation, and may provide subtle haptic feedback.

45. The product then returns control to the integrating website. The visitor does not have to press the original submit or confirmation control a second time unless the underlying action materially changed while verification was open.

46. The integrating website must validate the result before completing the protected action. A visual success animation alone never authorizes the action.

47. If result validation succeeds, the protected action continues exactly once.

48. If validation fails because the result expired, was already used, does not match the site or action, or is otherwise invalid, the action remains unperformed and the visitor receives an understandable option to start a fresh verification.

### QR phone handoff

49. The handoff screen explains that the visitor should scan a one-time QR code with a phone and that no native application or product account is required.

50. The QR code is large enough to scan at ordinary desktop viewing distance, is accompanied by concise numbered instructions, and has a non-QR alternative such as opening or entering a short link when reasonably supported.

51. The desktop displays the handoff status as one of: waiting for phone, phone connected, challenge active, confirmed, failed, disconnected, cancelled, or expired.

52. Scanning the QR code opens a secure mobile webpage that names the originating website and protected action before requesting motion permission.

53. Opening the QR link does not complete verification. It only connects the phone to the pending desktop session.

54. When the phone connects, the desktop updates promptly to “Phone connected.” The phone waits for the visitor to explicitly start the movement challenge.

55. Only one phone may control a handoff session at a time. If a second phone opens the same unused QR link, neither phone silently replaces the other; the desktop and phones explain the conflict and allow the visitor to restart with a fresh code.

56. The QR code and its underlying handoff session expire after two minutes by default. The desktop shows remaining validity when less than thirty seconds remain and provides a control to generate a new code.

57. Generating a new QR code immediately invalidates the previous code and disconnects any phone attached to it.

58. Reloading the desktop page or closing the verification dialog cancels the pending handoff unless the integrating website intentionally restores the same still-valid workflow.

59. If the phone disconnects before completing the challenge, the desktop reports the disconnection and allows reconnection only while the same handoff session remains valid.

60. The mobile handoff uses the same explanation, permission, calibration, challenge, retry, and accessibility behaviors as the direct-device flow.

61. After mobile success, the phone displays “Confirmed — you can return to your computer.” The desktop independently waits for server-confirmed completion rather than trusting a message supplied only by the phone.

62. After the desktop receives confirmed completion, it closes or advances the verification interface and continues the original protected action without another user submission.

63. A completed, expired, cancelled, or replaced QR link cannot be used to join another session or obtain another successful result.

### Accessible alternative

64. “Use another verification method” is available before motion permission, during calibration, during an active challenge, after failure, and in the QR handoff flow.

65. The alternative flow is keyboard accessible, screen-reader understandable, operable without device movement, and does not rely exclusively on vision, hearing, fine pointer control, memory, or time pressure.

66. The product allows the integrating website to offer one or more explicit alternatives, such as passkey confirmation, authenticated account confirmation, an email link, a one-time code, or a reviewed accessibility process.

67. The product clearly identifies when an alternative is operated by the integrating website and keeps the visitor within the same pending protected workflow.

68. Choosing an alternative cancels the current motion or QR attempt so two methods cannot race to authorize the same action.

69. Completing an alternative produces a verification result with the same site, action, expiry, and single-use guarantees as completing the motion challenge, while identifying the method used to the integrating website when its policy requires that distinction.

70. An unavailable or misconfigured alternative is never shown as selectable. If no alternative is configured, the integrating website must present a support path rather than a dead end.

71. Reduced-motion preferences disable nonessential animation. The challenge continues to show position changes necessary to perform the task, while avoiding decorative movement, pulsing, zooming, or parallax.

72. All controls have visible labels, logical focus order, visible focus indication, and touch targets suitable for coarse pointers. Status changes that require attention are announced to assistive technology without announcing every sensor update.

### Verification result and integration contract

73. A successful verification result is opaque to the browser and meaningful only when validated through the service by the integrating website's trusted backend.

74. A result is bound to the configured website, protected action, originating verification session, completion method, and creation time.

75. A result expires five minutes after issuance by default. Integrating websites may configure a shorter lifetime but cannot extend it beyond the service maximum.

76. A result is redeemable exactly once. The first valid redemption consumes it atomically; later redemption attempts fail without repeating the protected action.

77. Validation distinguishes at least these outcomes for the integrating website: valid and consumed, expired, already consumed, wrong website, wrong action, cancelled, and invalid.

78. The integrating website can associate its own opaque transaction identifier with a verification request. The identifier is returned during validation without being displayed to or treated as authority from the browser.

79. The product never exposes a reusable secret in the widget, QR code, mobile URL, browser storage, or success callback.

80. Client-side success events are advisory UI signals only. The integrating website must not perform the protected action until its backend receives a valid consumed result.

81. If the integrating website loses connection after consuming a result but before completing its action, repeating validation reports that the result was already consumed. The website is responsible for making its protected action idempotent using its transaction identifier.

### Concurrency, races, and lifecycle

82. Each verification session authorizes at most one protected action or explicitly defined protected workflow.

83. Opening multiple verification widgets for the same action does not allow multiple successful redemptions. The integrating website may designate the newest session as authoritative and cancel older sessions.

84. Success arriving at the same time as cancellation or expiry has one authoritative outcome. The visitor and integrating website receive consistent final status and the protected action never executes twice.

85. A browser back navigation, page reload, tab close, or route change cancels the visible attempt unless the integrating website explicitly restores the same valid workflow.

86. A challenge cannot be transferred to a different website, action, or customer configuration after creation.

87. Browser storage clearing, private browsing, and blocked third-party cookies do not by themselves prevent a same-page direct challenge or QR handoff from working.

88. Multiple tabs and windows do not share successful results unless they belong to the same explicitly defined workflow. A result created in one unrelated tab cannot authorize an action in another.

### Network and service failures

89. Every network-dependent transition has a finite pending state and a clear failure state. No spinner remains indefinitely.

90. If the network is unavailable before challenge creation, the visitor sees that verification could not start and may retry when connectivity returns.

91. If connectivity is lost during an active direct-device challenge, the interface may allow the current visual interaction to finish but does not display final confirmation until the service accepts the result.

92. If connectivity is lost during QR handoff, both devices explain their connection state independently and permit retry only while the session remains valid.

93. A transient service error does not consume an otherwise unused verification result unless the service has authoritatively accepted redemption.

94. Scheduled or unexpected service unavailability never produces a successful verification result. The integrating website may independently choose to proceed without verification under its own documented availability policy, but that decision is outside this product and must not be represented to the visitor or backend as successful physical verification.

95. Error messages expose no internal security thresholds, challenge answers, reusable identifiers, or details that materially simplify automated bypass.

### Privacy and data handling

96. Before the first challenge, the product provides a concise explanation that device-motion readings are used to evaluate the physical interaction.

97. Raw motion readings are used only for the active verification, are not sold, are not used for advertising, and are not used to construct cross-site behavioral profiles.

98. Raw motion readings exist only for the active attempt and are deleted after the service accepts or rejects that attempt; they are not retained as ordinary logs or analytics. The product separately documents exact retention periods for derived challenge measurements, security logs, and aggregate analytics.

99. Integrating websites can access verification outcome, timing, completion method, compatibility status, and coarse failure reason. They do not receive raw sensor streams by default.

100. The product does not expose one customer's visitor history to another customer.

101. QR handoff communicates the minimum information necessary to identify the originating website, action, and pending session. Sensitive transaction contents are not embedded directly in the QR code or mobile URL, and the one-time handoff credential must not be exposed through referrer headers, ordinary server access logs, browser history after connection, or third-party page resources.

102. Product analytics use aggregated or customer-scoped measurements and avoid stable cross-site visitor identifiers.

### Integrator-facing configuration and observability

103. An integrating website can configure its allowed web origins, protected action names, display name, visible action descriptions, theme-compatible presentation, result lifetime within permitted limits, fallback methods, and failure policy.

104. Unknown origins and unregistered action names cannot create results valid for that website.

105. The website can present the verification inline, in a modal, or as a dedicated page, but all modes expose the same states, choices, accessibility behavior, and security guarantees.

106. The widget adapts to mobile and desktop widths, light and dark appearance, zoom up to 200%, translated copy, and common text expansion without clipping essential controls or status.

107. The integrating website receives aggregate metrics for challenge starts, capability route, permission outcomes, calibration failures, retries, completions, alternatives, handoffs, expirations, abandonment, validation outcomes, and median completion time.

108. Analytics distinguish direct phone/tablet, direct laptop/convertible, QR phone handoff, and accessible alternative so product quality can be evaluated by route.

109. Analytics do not label every failed visitor as a bot. Failure categories describe observable outcomes such as permission denied, no sensor readings, timeout, disconnected, expired, cancelled, invalid movement, or validation mismatch.

110. The product provides a test environment and documented test credentials in which integrators can deterministically exercise success, failure, expiry, duplicate redemption, permission denial, missing sensors, QR disconnect, and alternative-method outcomes without weakening production verification.

### Language, safety, and compatibility invariants

111. Instructions use plain, non-accusatory language and avoid security jargon. They state the immediate action the visitor should take.

112. The product never instructs a visitor to move equipment that appears unsafe to move. Laptop instructions always provide phone handoff and another method alongside direct tilt.

113. The direct challenge works in portrait and landscape orientation when motion readings are available, recalibrating after an orientation change rather than interpreting it as challenge success.

114. The product supports current mainstream mobile browsers and progressively falls back to QR handoff or another method when motion APIs are absent, blocked, unreliable, or embedded in an incompatible webview.

115. An unsupported browser receives a useful explanation and available alternatives rather than a blank widget, generic error, or endless pending state.

116. Completion behavior remains consistent across embedding modes and supported browsers: the same protected action, result scope, expiry, and single-use rules apply everywhere.

117. Security hardening may change challenge generation and evaluation over time without changing these user-visible guarantees. Any change that materially affects movement difficulty, required hardware, accessibility, retained data, or integrator-visible outcomes requires this product specification to be updated.

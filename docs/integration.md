# Integration guide

## Browser

Expose the verification service under the merchant's origin (for example through `/motion-presence/` on the existing reverse proxy), register that exact origin and action, then add the custom element. The included single-node build is deliberately same-origin; a separately hosted multi-tenant service needs the origin bootstrap and CORS layer described in the production plan.

```html
<script type="module" src="https://verify.example.com/widget.js"></script>
<motion-presence site-key="pk_example" action="purchase" action-description="Confirm this purchase">
  Confirm purchase
</motion-presence>
```

Listen for `motion-presence-complete`. Its `resultToken` is an advisory opaque value, not authorization. Send it to your own backend over an authenticated merchant request.

```js
document.querySelector('motion-presence').addEventListener('motion-presence-complete', async (event) => {
  await fetch('/orders/confirm', {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({resultToken: event.detail.resultToken, transactionId})
  });
});
```

The element exposes `start()` and `cancel()`, and emits `motion-presence-status` for `started`, `cancelled`, `configuration-error`, and `confirmed`. It works in ordinary HTML and can be referenced from React, Vue, or server-rendered templates without framework wrappers.

## Trusted backend

The server-only client requires the verification URL, rotatable server secret, and exact registered merchant origin:

```ts
const verification = new MotionPresenceClient({baseUrl, serverSecret, origin: 'https://shop.example.com'});
const result = await verification.redeem({resultToken, action: 'purchase', transactionId, idempotencyKey: `purchase:${transactionId}`});
if (result.outcome === 'valid_consumed') await orders.createOnce(transactionId);
```

Use a finite timeout and make the protected action idempotent by transaction ID. Never complete an order from the browser event alone: a modified browser can fabricate DOM events and sensor samples; only backend redemption authorizes the action.

## Content Security Policy

Allow the verification origin in `script-src`, `frame-src`, and `connect-src`. Cross-origin device motion also needs an `accelerometer` and `gyroscope` Permissions Policy grant.

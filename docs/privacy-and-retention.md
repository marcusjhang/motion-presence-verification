# Privacy and retention

Raw orientation samples live only in request memory while an attempt is evaluated. They are released immediately afterward and are never written to logs, SQLite, analytics, or the operator screen.

The activity store contains a process-keyed, non-reversible session correlation value plus coarse event name, route, failure category, duration, and timestamp. It never stores transaction IDs, IP addresses, motion samples, handoff credentials, result tokens, server secrets, or stable cross-site visitor identifiers.

- Active sessions and handoff state: at most two minutes
- Successful result: at most five minutes from completion
- Phone lease: fifteen seconds without heartbeat
- Coarse audit events: thirty days
- Operator aggregates: calculated from retained coarse events

`Telemetry.enforceRetention()` is idempotent and deletes events older than thirty days. Hosted deployments should schedule it daily and may configure shorter privacy windows.

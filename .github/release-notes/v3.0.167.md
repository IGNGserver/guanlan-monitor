# Device State Console v3.0.167

## Lower whole-Hub resource use

- Reduce repeated work across telemetry ingestion, aggregation, Redis read models, history queries, and overview responses while preserving existing telemetry, history, gap, valid-zero, counter, retention, and client-compatibility semantics.
- Serve the production Web bundle as static files behind the fixed internal API proxy, with explicit trusted-proxy handling for externally terminated TLS.
- Reuse exact aggregate snapshots when inputs are unchanged; approximate rolling aggregates and storage migrations are not enabled.
- Keep the existing Node.js and MySQL architecture. Go and SQLite experiments did not establish a net whole-stack benefit and are not part of the production path.

## Recovery and compatibility

- Bound background work and improve readiness checks so the Hub does not report ready while MySQL is unavailable.
- No database migration or client credential change is required. Existing persisted Redis/MySQL data remains authoritative, and old images can read the existing formats.
- When TLS is terminated by an external proxy, configure `DSC_TRUSTED_TLS_PROXY_CIDRS` to the actual isolated proxy source range before deployment; the default remains fail-closed.

## Performance evidence and limitations

- An isolated synthetic run observed lower stack CPU and sampled peak memory for the candidate build. These are single-run observations, not production or statistically stable savings; some block-I/O evidence was unavailable.
- Production-scale concurrency, full-year history, realistic live-RPC load, and a 24–72-hour soak remain unverified. Do not treat these measurements as a production performance guarantee.
- The tag-triggered release workflow runs platform tests and artifact verification on GitHub Actions. PR #95 also passed the isolated database, browser, recovery, and rollback gates documented in `docs/performance/HUB_OPTIMIZATION.md`.

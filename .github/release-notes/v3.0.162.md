# Device State Console v3.0.162

## Stable database compatibility

- Stable server deployments now accept non-placeholder MySQL application-account passwords with at least 6 characters, matching existing installations that use a short credential.
- Stable Compose preflight preserves the active password from `MYSQL_URL` instead of replacing it with a stale MySQL initialization password.
- The MySQL root password requirement remains at least 16 characters in stable deployments. Six-character application passwords have lower resistance to guessing; use a longer random value whenever possible and keep MySQL private to the Compose network.

## Deployment reliability

- Production deployment now propagates remote SSH/SCP failures so a rejected preflight or failed health check cannot be reported as a successful deployment.

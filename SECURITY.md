# Security Policy

## Supported Versions

This project is currently maintained on the latest default branch only.

## Reporting a Vulnerability

Please do not open a public issue for credential leaks, authentication bypasses, or remote execution problems.

Instead, contact the maintainer privately and include:

- Affected version or commit
- Reproduction steps
- Expected impact
- Any logs or screenshots that help verify the report

## Deployment Notes

- Change every secret in `.env` before exposing the service to other users.
- Set `SESSION_COOKIE_SECURE=true` when the site is served over HTTPS.
- Restrict access to the web UI and server ports with a reverse proxy or firewall when possible.

# v0.1.107

## Unified Access Key

- `ACCESS_KEY` is now the only credential for the web console, Windows and Android clients, and all agents.
- Existing deployments upgrade with the web `ACCESS_KEY` taking precedence. Any legacy `AGENT_SHARED_SECRET` value is ignored.
- The unified key accepts a non-empty value, including short private-network keys such as `100728`.
- Update every agent and client to use the same value as the hub `ACCESS_KEY` after upgrading.

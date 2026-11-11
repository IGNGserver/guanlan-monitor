# Device State Console v3.0.166

## Long-lived browser login

- Browser sessions now last **90 days** instead of eight hours. Requests made near the end of the window slide the expiry forward, so an actively used console no longer forces the access key to be re-entered every workday.
- A session is capped at **365 days from the original login** and then needs a fresh login, even if it has stayed active.
- The original `issuedAt` is preserved during renewal. The web client uses it as its cache scope, so renewing does not discard the open view or its offline snapshot.
- Existing eight-hour cookies remain valid and are renewed on their next authenticated request; deployment does not force everyone to sign in again.
- Desktop, Android and iOS credentials, and Agent Bearer keys, are unchanged. iOS now restores a Keychain-backed session automatically on cold launch instead of stopping at the login screen.

## Security and operations

- The browser session is still a signed, HttpOnly, SameSite=Lax cookie and is bound to the current `ACCESS_KEY`. Rotating `SESSION_SECRET` invalidates all Web sessions without affecting Agents; rotating `ACCESS_KEY` invalidates all clients and Agents.
- Logout clears the browser copy, but a copied stateless cookie cannot be revoked individually before it expires. Rotate the secrets if a browser profile is lost or exposed.
- No database migration is required. This release changes only the session lifetime and client login presentation.

## Validation

- Server auth unit and HTTP route tests cover sliding renewal, the one-year cap, legacy cookie compatibility, credential binding and expired-session rejection.
- Full CI, platform builds and the release asset checks run on the version tag; the stable Docker image is published separately and resolved by immutable digest for production.

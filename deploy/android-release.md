# Android Release

## Signed Release APK

Android release packages must be signed with the same keystore every time. If you lose the keystore, future APK updates cannot replace the installed app.

Release builds reject cleartext `http://` Hub addresses and disable Android cleartext traffic. LAN deployments must provide HTTPS, for example through a TLS reverse proxy; debug builds retain HTTP support for local development.

Android `versionCode` is encoded from the semantic version as
`major * 1,000,000 + minor * 10,000 + patch`. Keep this mapping when changing
the version: removing the dots would make a `0.2.x` APK look older than an
installed `0.1.10x` APK and Android would reject the upgrade as a downgrade.

This repository expects signing material to stay local only:

- keep the keystore under `android/signing/`
- do not commit the keystore
- back it up separately in a safe location

The directory is ignored by Git through `.gitignore`.

## Recommended Layout

```text
android/signing/
  guanlan-release.jks
```

## Build a Signed APK

Set signing variables before building:

```bash
export DSC_UPLOAD_STORE_FILE=android/signing/guanlan-release.jks
export DSC_UPLOAD_STORE_PASSWORD='your-store-password'
export DSC_UPLOAD_KEY_ALIAS='guanlan-release'
export DSC_UPLOAD_KEY_PASSWORD='your-key-password'
```

If you keep a local credentials file in the project directory, you can load it before building:

```bash
source android/signing/release-credentials.env
```

Then build:

```bash
./android/gradlew -p android clean assembleRelease
```

Signed output:

- `android/app/build/outputs/apk/release/app-release.apk`

Package the signed APK with the release name:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\package-android-release.ps1
```

Output: `release/android/DeviceStateConsole-Android-vX.Y.Z.apk`

Unsigned output when signing variables are missing (development only; the release workflow refuses to publish it):

- `android/app/build/outputs/apk/release/app-release-unsigned.apk`

## GitHub Actions Test Release

The tag-triggered test-release workflow never uploads an unsigned APK. Configure
these repository secrets with the base64-encoded keystore and its credentials to
keep the same signing certificate across releases:

- `DSC_ANDROID_KEYSTORE_BASE64`
- `DSC_ANDROID_STORE_PASSWORD`
- `DSC_ANDROID_KEY_ALIAS`
- `DSC_ANDROID_KEY_PASSWORD`

When any of these secrets is unavailable or invalid, the workflow fails. It never
generates an ephemeral signing key, so every distributed APK remains upgradeable
with the repository's configured signing certificate.

## Verify the Signature

Example:

```bash
"$ANDROID_HOME/build-tools/36.1.0/apksigner" verify --print-certs \
  android/app/build/outputs/apk/release/app-release.apk
```

## Release Naming

Suggested release asset name:

- `DeviceStateConsole-Android-v0.1.2.apk`

## Security Notes

- Never upload the keystore to GitHub.
- Never send the keystore over chat or email without encryption.
- Store the password in a password manager.
- Back up both the keystore file and its password.

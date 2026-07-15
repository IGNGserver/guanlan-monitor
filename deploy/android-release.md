# Android Release

## Signed Release APK

Android release packages must be signed with the same keystore every time. If you lose the keystore, future APK updates cannot replace the installed app.

The current Android client intentionally allows `http://` server addresses in release builds so it can connect to LAN deployments that do not use HTTPS yet.

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

Unsigned output when signing variables are missing:

- `android/app/build/outputs/apk/release/app-release-unsigned.apk`

## Verify the Signature

Example:

```bash
"$ANDROID_HOME/build-tools/36.1.0/apksigner" verify --print-certs \
  android/app/build/outputs/apk/release/app-release.apk
```

## Release Naming

Suggested release asset name:

- `guanlan-android-v0.1.2.apk`

## Security Notes

- Never upload the keystore to GitHub.
- Never send the keystore over chat or email without encryption.
- Store the password in a password manager.
- Back up both the keystore file and its password.

# KAI TRAD Android

Official Android shell for KAI TRAD.

## Architecture
- Web/trading core remains hosted by the KAI TRAD Cloudflare Worker.
- Android is a hardened presentation shell only.
- No broker secret, private API key, order credential, strategy parameter, or live-execution secret is embedded in the APK.
- Production host: `kai-trad-pwa.ardarawk.workers.dev`
- Native marker: `?native=android`

## Application identity
- Package: `com.ardacore.kaitrad`
- App label: `KAI TRAD`
- Minimum Android: API 26
- Target/compile SDK: 36

## Security defaults
- HTTPS-only internal navigation.
- WebView restricted to the production host.
- Cleartext and mixed content blocked.
- Direct file/content access disabled.
- No JavaScript-to-Android bridge.
- Third-party cookies disabled.
- External links delegated to Android.
- WebView debugging disabled in release builds.
- PAPER/live safety remains controlled by the existing backend configuration.

## CI
`android-validation.yml` builds debug and unsigned release variants. The debug artifact is an installable RC for device testing.

Production signing must use repository secrets and a KAI TRAD-specific keystore. Never commit a keystore or password.

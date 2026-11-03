# Building the LingoStep Android APK (optional, via Capacitor)

LingoStep is a static single-page app, so it runs unchanged inside a thin
native Android shell. The **PWA install (recommended)** needs no build at all —
see "Install LingoStep on an Android phone" in the README. Use this route only
when you specifically want a store-style APK with a launcher icon.

> Status: the configuration below is prepared and checked against the repo
> structure, but **no APK has been built or tested from this working copy** —
> the build requires Android Studio / the Android SDK on your machine.
> Steps are the standard Capacitor workflow; verify locally before shipping.

## Prerequisites

- Node.js ≥ 18
- Android Studio (includes the Android SDK) — or command-line SDK + platform-tools
- JDK 17 (bundled with recent Android Studio)

## One-time project setup

```bash
# from the repository root
npm install --save-dev @capacitor/cli @capacitor/core @capacitor/android

npx cap add android               # creates the android/ project using capacitor.config.json
```

`capacitor.config.json` in the repo root already contains:

- `appId`: `com.anamiir2collab.lingostep`
- `appName`: `LingoStep`
- `webDir`: `.` (the whole static site is the web bundle)
- `androidScheme: https` (keeps service-worker/IndexedDB behavior consistent
  with the https deployment)

## App name and launcher icon

- App name: comes from `appName` in `capacitor.config.json` → set at
  `android/` project creation; verify `android/app/src/main/res/values/strings.xml`
  shows `LingoStep`.
- Launcher icon: Capacitor copies from `assets/` only via the
  `@capacitor/assets` tool. Using the **official logo** (`icons/icon-512.png`):

  ```bash
  npm install --save-dev @capacitor/assets
  mkdir -p assets/src
  cp icons/icon-512.png assets/src/logo.png          # source artwork
  # optional splash: assets/src/splash.png (2732×2732 recommended)
  npx capacitor generate-assets      # generates mipmap-* launcher icons + splash
  ```

  The generated icons preserve the official logo proportions — never a
  placeholder letter.

## Sync and open

```bash
npx cap sync android               # copies web assets + config into android/
npx cap open android               # opens the project in Android Studio
```

## Back-button behavior

Capacitor's default WebView handles the Android back button by going back in
the WebView history. LingoStep uses hash routing (`#/section/…`, `#/lesson/…`),
which produces real history entries, so back navigation walks the lesson →
section → home chain and finally exits the app. Test this after opening any
lesson. If you want the app to always exit to home instead, override
`onBackPressed` in `MainActivity` later — the default is correct for a start.

## Build a debug APK

```bash
cd android
./gradlew assembleDebug
# output: android/app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Build a release APK (unsigned → signed)

```bash
cd android
./gradlew assembleRelease
# sign it (adjust keystore paths/aliases):
keytool -genkey -v -keystore lingostep.keystore -alias lingostep -keyalg RSA -keysize 2048 -validity 10000
apksigner sign --ks lingostep.keystore --out LingoStep.apk \
  app/build/outputs/apk/release/app-release-unsigned.apk
```

## Routing & offline notes inside the APK

- The app uses relative paths (`./js/...`, `./manifest.json`) and hash routes,
  so it works from the WebView's `https://localhost` origin without any
  base-path changes.
- The service worker (`sw.js`) also works inside the WebView; "Download all
  lessons for offline use" in **More → Application** primes the same cache.
- The PWA manifest is ignored by the WebView — the launcher icon/name come
  from the Android project, which is why the `capacitor generate-assets`
  step above matters.

## Checklist before shipping an APK

- [ ] `npx cap sync android` run after the last web change
- [ ] Launcher icon generated from the official logo (no letter placeholder)
- [ ] App label under the icon reads `LingoStep`
- [ ] Back button: lesson → section list → home → exit
- [ ] Audio (speech synthesis) plays; voices depend on the device TTS engine
- [ ] Release APK signed and `adb install` tested on a real device

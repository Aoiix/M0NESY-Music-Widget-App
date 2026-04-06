# M0NESY-Music-Widget-App
This is my first App ever so I hope you guys like it.
m0NESY is one of my idols so I really wanted to make my first project around him.

Credits:
Me (@xaoiix on discord)
My friend (@_kaguya. on discord)

## Install for non-coders (GitHub Releases)
This repo now includes an automated build pipeline that creates downloadable installers.

1. Open the **Releases** page on GitHub.
2. Download the installer for your device:
   - macOS: `.dmg`
   - Windows: `.exe` (NSIS installer) or portable `.exe`
   - Linux: `.AppImage` or `.deb`
3. Install and run like a normal app.

Note for macOS users:
Unsigned apps can show a Gatekeeper warning. If that happens, right-click the app and choose **Open** once to allow it.

## Publish a new downloadable release
Push a tag like `v1.0.1`:

```bash
git tag v1.0.1
git push origin v1.0.1
```

GitHub Actions will build and upload installers automatically to a new Release.

## Local development
Run locally:

```bash
npm start
```

## Desktop app mode (default)
The desktop app now launches as a normal app (visible in Dock/Taskbar and app switchers), with tray controls available.

## Optional widget mode
If you want the hidden widget-style behavior, run:

```bash
npm run dev:widget
```

Widget mode is designed to stay out of Dock/Taskbar and can feel "invisible" if you are troubleshooting launch issues.

Hotkeys in the widget window:
- `Shift + L`: lock/unlock widget position
- `Shift + W`: enable/disable click-through

## PWA mode (iPad/Home Screen)
Start the web version:

```bash
npm run start:web
```

Then open `http://127.0.0.1:4173` and use:
- Safari (iPad): Share -> Add to Home Screen
- Chrome/Edge desktop: Install app prompt from address bar

## Important iPhone/iPad note
This app is built with Electron, which targets desktop operating systems (macOS/Windows/Linux).
Electron apps cannot be installed directly on iPhone/iPad.

To support iPhone/iPad with true widgets, a separate mobile app is required (typically Swift/SwiftUI + WidgetKit for iOS/iPadOS) and distribution through TestFlight/App Store.

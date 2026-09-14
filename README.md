# Embiggen

A mobile-first PWA that takes text input and displays it in the largest
possible font to fill the entire screen — for communicating silently in
noisy environments like bars, concerts, and shows. Named after the
Simpsons word.

## How it works

1. **Open** — a text box and an "Embiggen" button.
2. **Embiggen** — a zoom animation grows the text to fill the screen.
3. **Display mode** — text wraps and scales to the largest font that fits;
   the screen stays awake (Screen Wake Lock).
4. **Tap** anywhere to replay the zoom animation.
5. **Share button** renders the display to a canvas image and opens the
   native share sheet (Web Share API, with a download fallback).
6. **Back** returns to the text box and clears it.

Theme follows the system dark/light preference. Text case is preserved
exactly (no forced uppercase).

## Tech stack

Vanilla HTML/CSS/JS — no framework, no build step, no npm dependencies
for the web app itself. The display font is [Anton](https://fonts.google.com/specimen/Anton),
self-hosted as a `.woff2` so it works offline.

The web app is also packaged as a native Android app via
[Capacitor](https://capacitorjs.com/), living in `app/`.

## Project structure

```
index.html          Two-view markup (home / display)
style.css            Styling, theming, zoom animation
app.js                Navigation, font-fit sizing, wake lock, canvas share
sw.js                  Service worker — offline asset caching
manifest.json     Web app manifest (installable PWA)
fonts/                  Self-hosted Anton .woff2
icons/                   PWA icons

app/                     Capacitor Android wrapper
  sync-web.js       Copies the web files above into app/www/ for the native build
  capacitor.config.json
  android/            Generated native Android project
```

## Running the web app locally

Service workers require `http://` (or `localhost`), not `file://`, so serve
the root directory with any static file server, e.g.:

```
uv run python -m http.server
```

Then open `http://localhost:8000`.

## Building the Android app

From `app/`:

```
npm install
node sync-web.js       # copies the web app into app/www/
npx cap sync android
npx cap open android    # or: cd android && ./gradlew assembleDebug
```

## Project history

Built in tracked phases — see `tickets/` in the project vault for the full
spec and per-ticket implementation notes:

- **Phase 1 — Core App:** scaffolding, home screen, display mode, zoom
  animation, navigation
- **Phase 2 — Share + Wake Lock:** screen wake lock, canvas image
  generation, share
- **Phase 3 — PWA Polish:** manifest/icons, service worker, mobile UX
- **Android App:** Capacitor project setup, native build, gesture fixes

# Wortschatz — German Trainer (installable PWA)

A free, **offline-capable** spaced-repetition German trainer. No account, no server —
your deck lives in your browser (localStorage). Once installed it works with no internet.

## Put it online with GitHub Pages (free, ~3 minutes)

1. Go to **github.com** → **New repository**. Name it `wortschatz`, set it **Public**, click **Create repository**.
2. On the new repo page click **"uploading an existing file"**. Drag in **every file from this folder**:
   `index.html`, `manifest.webmanifest`, `sw.js`, `.nojekyll`, and all the `*.png` icons. Then **Commit changes**.
   *(The `.nojekyll` file may be hidden in Explorer — enable "Hidden items" in the View menu, or upload it too. It's optional but recommended.)*
3. In the repo go to **Settings → Pages**. Under **Source** pick **Deploy from a branch**,
   Branch = **main**, folder = **/ (root)**, then **Save**.
4. Wait ~1 minute. Your app is live at:
   **https://YOUR-USERNAME.github.io/wortschatz/**
5. Open that URL **on your phone** and install it:
   - **iPhone (Safari):** Share button → **Add to Home Screen**.
   - **Android (Chrome):** you'll see an **Install app** prompt (or ⋮ menu → **Install app**).

It now runs fullscreen, offline, with its own home-screen icon. 🇩🇪

## Good to know

- **All paths are relative**, so it works under the `/wortschatz/` subpath. Rename the repo if you like — nothing to change.
- **Your progress is per-device.** Use **Export deck** (app footer) to back up or move your deck to another device via **Import**.
- **To update the app later:** replace the files in the repo and **bump `VERSION`** in `sw.js`
  (e.g. `wortschatz-v1` → `wortschatz-v2`). That's the one line that tells installed phones to refresh the cached app.
- Audio uses your device's built-in German voice (free). If a word is silent, your device may not have a
  German (de-DE) voice installed — add one in the phone's language/accessibility settings.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app (HTML + CSS + JS in one file) |
| `manifest.webmanifest` | App name, colors, icons, standalone display |
| `sw.js` | Service worker — caches the app for offline use |
| `icon-*.png`, `apple-touch-icon.png`, `favicon-32.png` | App icons |
| `.nojekyll` | Tells GitHub Pages to serve files as-is |

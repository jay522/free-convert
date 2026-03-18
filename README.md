# free-converter

free-converter is a static web app for common client-side file conversions:

- `webm -> mp4`
- `screen recording -> webm/mp4`
- `camera recording -> webm/mp4`
- `jpg/png/webp -> pdf`
- `merge multiple pdf files`
- `png/webp -> jpg`
- `jpg/webp -> png`
- `jpg/png -> webp`

## Why this fits serverless hosting

This app does not require a traditional backend. Conversions run in the browser
using:

- `ffmpeg.wasm` for video conversion
- `pdf-lib` for PDF generation
- Canvas APIs for image conversion

The runtime assets needed by the browser are stored in the local `vendor/`
folder, so deployment does not depend on `node_modules` or an external CDN.

Additional product features included in this version:

- screen recording with format, quality, width, FPS, and audio controls
- camera recording with the same local export flow
- local conversion history
- local-only analytics dashboard
- local workspace lock with a PIN
- adaptive large-video warnings and cancellation
- service worker caching for the app shell
- packaged Chrome extension build in `extension/`

That means you can host it on:

- Vercel
- Netlify
- Cloudflare Pages
- GitHub Pages
- Any static file host

## Local run

Because the app is plain HTML, CSS, and JavaScript, you can serve the folder
with any static file server.

Example:

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080`.

If you prefer project scripts:

```powershell
npm run serve
```

## Deploy

1. Push this folder to a Git repository.
2. Import the repo into your host of choice.
3. Configure the project as a static site.
4. Use the repository root as the publish directory.

No build command is required.

## Chrome Extension

The Chrome extension build lives in `extension/`.

To load it:

1. Open `chrome://extensions`
2. Turn on `Developer mode`
3. Click `Load unpacked`
4. Select the `extension` folder

## Notes

- Large `webm -> mp4` conversions are CPU and memory intensive because they run
  in the browser.
- Screen recording relies on browser support for both Screen Capture and
  `MediaRecorder`. Chromium and Firefox give the most complete support today.
- When native MP4 recording is not available, the recorder captures locally as
  WebM first and converts the result to MP4 in the browser worker.
- This build includes adaptive presets, warnings, and a cancel action to make
  heavy browser-based video jobs safer.
- Manual and automated QA assets live in `qa/browser_matrix.py` and
  `qa/MANUAL_QA.md`.

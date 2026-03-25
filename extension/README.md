# free-converter Chrome Extension

This folder contains a full Chrome extension build of the current converter and recorder app.

## Load it in Chrome

1. Open `chrome://extensions`
2. Turn on `Developer mode`
3. Click `Load unpacked`
4. Choose this `extension` folder

## How it works

- Clicking the extension icon opens the full app in a new tab.
- The converter, recorder, history, diagnostics, and workspace lock all run locally.
- `ffmpeg.wasm`, `pdf-lib`, and the image/PDF tools are bundled inside `extension/app/vendor`.

## Notes

- The extension keeps the same browser-side behavior as the website, but uses a packaged app page instead of the website shell.
- No remote fonts or CDN assets are required by the extension build.
- `Screen + Camera` is still shown as coming soon here too, matching the current recorder UI.

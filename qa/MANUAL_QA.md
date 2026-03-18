# Manual QA Checklist

Use this checklist when validating free-converter with real files before release.

## Browsers

- Chromium or Chrome on desktop
- Firefox on desktop
- Safari or WebKit on desktop
- One mobile browser on iOS
- One mobile browser on Android

## Core conversions

- Small `webm -> mp4`
- Medium `webm -> mp4` around 30 to 60 seconds
- Portrait `webm -> mp4`
- Silent `webm -> mp4`
- Screen recording to `webm`
- Screen recording to `mp4`
- Screen recording with `Entire screen` selected while switching between apps or windows
- Screen recording with `App window` selected and confirm only that window is captured
- Screen recording with `Browser tab` selected and confirm only that tab is captured
- Screen recording with `compact`, `balanced`, and `crisp` quality
- Screen recording with `original`, `1280`, and `854` max width options
- Screen recording with `15`, `24`, `30`, and `60` FPS options
- Screen recording with and without system/tab audio
- Camera recording to `webm`
- Camera recording to `mp4`
- Camera recording with `None` and `Microphone` audio modes
- Confirm `Screen + Camera` stays disabled and marked as coming soon
- `jpg/png/webp -> pdf` with 1 image
- `jpg/png/webp -> pdf` with 10+ images
- Merge 2 PDF files
- Merge PDFs with different page sizes
- `png/webp -> jpg`
- `jpg/webp -> png`
- `jpg/png -> webp`

## Large-file handling

- `webm -> mp4` above 100 MB with default settings
- `webm -> mp4` above 100 MB with compressed profile
- `webm -> mp4` above 5 minutes with compressed profile
- Cancel an in-progress large video conversion
- Record a screen session longer than 5 minutes and confirm the timer, stop flow, and final download stay responsive
- Reload the page after a large conversion and confirm history/analytics remain

## Workspace lock

- Save a display name
- Set a PIN
- Lock the workspace and confirm the convert action is disabled
- Unlock the workspace with the correct PIN
- Attempt unlock with a wrong PIN
- Remove the PIN after unlocking

## Offline and cache

- Load the app once online
- Reload and verify the shell still opens with the service worker active
- Confirm cached assets do not block fresh conversions after a hard refresh

## Accessibility and UX

- Keyboard navigation through preset select, file picker, option controls, and lock controls
- Mobile layout at narrow width
- Error messages when the wrong file type is selected
- Status text and progress bar update during long operations
- Recorder status, timer, and preview update correctly before, during, and after a capture

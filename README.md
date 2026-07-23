# MMM-MotionControl

A [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror) module that turns a TV on and off based on presence, by relaying commands to [MMM-CECControl](https://github.com/nischi/MMM-CECControl).

It has no UI — it runs in the background and reacts to events. Presence can come from three independent sources, merged together:

- **Camera motion** — this module's own lightweight detector (Raspberry Pi Camera via `rpicam-vid`, or a USB webcam via `ffmpeg`). This is the cheap "gate": motion instantly turns the TV on **and wakes** the (expensive) face-recognition modules.
- **Face recognition** — [MMM-Facial-Recognition-OCV3](https://github.com/normyx/MMM-Facial-Recognition-OCV3) and/or [MMM-Face-Reco-DNN](https://github.com/nischi/MMM-Face-Reco-DNN). Once someone is recognized, their presence keeps the TV on.
- **`ontime` windows** — time ranges where the TV is always kept on.

The TV turns **off** only after `delay` has elapsed with **all** sources quiet.

## How it works

```
node_helper  ──spawn──►  rpicam-vid (Pi Camera)  |  ffmpeg scdet (USB webcam)
     │  motion events
     ▼
MMM-MotionControl  ──►  CECControl on/off   (turn the TV on/off)
     ├────────────►  MOTION_WAKE + GET_LOGGED_IN_USERS   (motion starts: wake face recognition)
     └────────────►  MOTION_CLEARED                      (motion stops: face recognition can stand down)
```

Motion detection runs on a tiny low-resolution stream at a low frame rate, so it stays very light on a Raspberry Pi. The Pi Camera path (`rpicam-vid`'s native `motion_detect` post-processing stage) is the recommended, lowest-CPU option; the USB path is a fallback and costs noticeably more CPU.

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/nischi/MMM-MotionControl.git
cd MMM-MotionControl
npm install
```

Then add the module to the `modules` array in `~/MagicMirror/config/config.js` (see the example below).

## Prerequisites

- **Raspberry Pi OS Bookworm (or newer)** with **`rpicam-apps`** installed (`rpicam-vid` on `PATH`) for the Pi Camera Module / CSI camera. This is preinstalled on recent Raspberry Pi OS images.
- **`ffmpeg`** installed for the USB-webcam backend (`sudo apt install ffmpeg`).
- The companion module [MMM-CECControl](https://github.com/nischi/MMM-CECControl) to actually switch the TV.
- The face-recognition modules are **optional** — the module works with camera motion alone.

> **USB CPU note:** the USB backend decodes video in software and is materially heavier than the Pi Camera path. Keep the resolution and frame rate low, and prefer the Pi Camera Module where possible.

## Configuration

| Config                     | Description                                                                                                                                | Default            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `delay`                    | Delay (ms) before turning the TV off once every presence source is quiet.                                                                  | `15000`            |
| `interval`                 | Poll interval (ms) for MMM-Face-Reco-DNN.                                                                                                  | `5000`             |
| `useFacialRecognitionOCV3` | Use MMM-Facial-Recognition-OCV3 as a presence source.                                                                                      | `false`            |
| `useMMMFaceRecoDNN`        | Use MMM-Face-Reco-DNN as a presence source.                                                                                                | `false`            |
| `ontime`                   | Time windows where the TV is always on, e.g. `['0700-1200', '1300-2000']` (does not span midnight).                                        | `[]`               |
| `useCameraMotion`          | Master switch for the built-in camera motion detector.                                                                                     | `false`            |
| `camera`                   | Capture backend: `'auto'` \| `'rpicam'` (Pi Camera / CSI) \| `'usb'` (webcam).                                                             | `'auto'`           |
| `usbDevice`                | V4L2 device for the USB backend (and the `'auto'` fallback).                                                                               | `'/dev/video0'`    |
| `loresWidth`               | Low-res stream width the motion analysis runs on (rpicam).                                                                                 | `128`              |
| `loresHeight`              | Low-res stream height (rpicam).                                                                                                            | `96`               |
| `framerate`                | Capture frame rate for both backends. Low fps = low CPU.                                                                                   | `5`                |
| `mainWidth`                | rpicam main stream width (discarded; kept small).                                                                                          | `1280`             |
| `mainHeight`               | rpicam main stream height.                                                                                                                 | `720`              |
| `motionSensitivity`        | rpicam `motion_detect` tuning (see below).                                                                                                 | see below          |
| `sceneThreshold`           | ffmpeg `scdet` threshold for the USB backend (lower = more sensitive).                                                                     | `12`               |
| `usbHoldMs`                | USB: how long (ms) to sustain "motion" between scene-change events.                                                                        | `2000`             |
| `motionDebounce`           | Falling-edge debounce (ms) applied to the raw camera signal.                                                                               | `1500`             |
| `motionOnPattern`          | Advanced: regex (string) overriding the rpicam "motion on" log matcher.                                                                    | `null`             |
| `motionOffPattern`         | Advanced: regex (string) overriding the rpicam "motion off" log matcher.                                                                   | `null`             |
| `wakeNotification`         | Notification broadcast on the camera-motion rising edge (to wake other modules).                                                           | `'MOTION_WAKE'`    |
| `clearedNotification`      | Notification broadcast on the camera-motion falling edge (after `motionDebounce`), so other modules know motion is gone. Falsy = disabled. | `'MOTION_CLEARED'` |

### `motionSensitivity` (rpicam)

These map to the `motion_detect` post-processing stage. Defaults:

```javascript
motionSensitivity: {
  regionThreshold: 0.005, // proportion of changed pixels that triggers motion
  differenceM: 0.1,       // per-pixel difference multiplier
  differenceC: 10,        // per-pixel difference constant
  framePeriod: 5,         // evaluate motion every N frames
  roi: [0.0, 0.0, 1.0, 1.0] // region of interest: [x, y, width, height] (fractions)
}
```

### Tuning sensitivity

- **Too many false triggers** → raise `regionThreshold` (e.g. `0.01`), or narrow `roi` to just the area you care about.
- **Missing real motion** → lower `regionThreshold`, or lower `sceneThreshold` for USB.
- The shipped `motion_detect.json` mirrors these defaults and can be used to test `rpicam-vid` by hand (see Verifying below).

## Notifications

The module **emits**:

- `CECControl` with payload `'on'` / `'off'` — to MMM-CECControl.
- `MOTION_WAKE` (configurable via `wakeNotification`) — broadcast when camera motion **starts**.
- `MOTION_CLEARED` (configurable via `clearedNotification`) — broadcast when camera motion **stops** (after `motionDebounce`), so face recognition and other modules can stand down.
- `GET_LOGGED_IN_USERS` — to poll / wake MMM-Face-Reco-DNN.

It **listens for** `CURRENT_USER` (OCV3) and `LOGGED_IN_USERS` (DNN).

### Event flow

| Trigger                               | Notifications emitted                                    |
| ------------------------------------- | -------------------------------------------------------- |
| Motion starts                         | `MOTION_WAKE`, `GET_LOGGED_IN_USERS`, `CECControl: 'on'` |
| Motion continues                      | _(nothing — already on)_                                 |
| Motion stops (after `motionDebounce`) | `MOTION_CLEARED` — the TV is **not** turned off yet      |
| Everyone gone (after `delay`)         | `CECControl: 'off'`                                      |
| Motion/face returns during a wait     | _(nothing — pending timers are cancelled)_               |

Note: `MOTION_WAKE` / `MOTION_CLEARED` are module-bus broadcasts (subscribe with `notificationReceived`). The TV only turns off after `delay` once **every** source — camera motion, face recognition, and `ontime` — is quiet.

## Full configuration example

```javascript
{
    module: 'MMM-MotionControl',
    config: {
        // Delay to turn the TV off once everything is quiet
        delay: 15000,
        // Poll interval for MMM-Face-Reco-DNN
        interval: 5000,

        // Face recognition (optional)
        useFacialRecognitionOCV3: false,
        useMMMFaceRecoDNN: false,

        // Windows where the TV is always on
        ontime: [],

        // Built-in camera motion detection
        useCameraMotion: true,
        camera: 'auto',        // 'auto' | 'rpicam' | 'usb'
        usbDevice: '/dev/video0',
        framerate: 5,
        motionSensitivity: {
            regionThreshold: 0.005,
            differenceM: 0.1,
            differenceC: 10,
            framePeriod: 5,
            roi: [0.0, 0.0, 1.0, 1.0]
        },
        wakeNotification: 'MOTION_WAKE',
        clearedNotification: 'MOTION_CLEARED'
    }
}
```

## Verifying the camera

Before enabling the module, you can confirm the Pi Camera motion stage works from the shell:

```bash
cd ~/MagicMirror/modules/MMM-MotionControl
rpicam-vid -t 0 --nopreview --lores-width 128 --lores-height 96 \
  --post-process-file motion_detect.json -o /dev/null
```

Wave at the camera — you should see `Motion detected` / `Motion stopped` lines on stderr. If your `rpicam-apps` version prints different wording, set `motionOnPattern` / `motionOffPattern` accordingly.

## Development & testing

Unit tests cover the pure logic (the presence state machine and the motion signal conditioning) and need no camera or MagicMirror install — they use Node's built-in test runner:

```bash
npm test          # lint + format check + unit tests (what CI runs)
npm run test:unit # just the unit tests
```

### Live camera test (no MagicMirror needed)

You can point the real detector at any camera and watch the motion events in your terminal — handy for tuning sensitivity or trying it on a laptop before deploying to the Pi. It uses the USB/`ffmpeg` backend on a Mac (`brew install ffmpeg` first) and the Pi Camera backend on a Raspberry Pi:

```bash
npm run test:camera            # auto-detect backend
node test/live-camera.js usb   # force the webcam backend (e.g. on macOS)
node test/live-camera.js usb 1 # webcam, device index/path "1"
```

Move in front of the camera; you'll see `🟢 MOTION DETECTED` / `⚪️ motion cleared`. Press Ctrl+C to stop. On macOS the first run triggers a camera-permission prompt for your terminal.

## Screenshot

There is nothing to screenshot — the module has no UI and only reacts to events to turn the TV on and off.

## License

MIT © Thierry Nischelwitzer

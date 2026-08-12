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
     │  motion events (MOTION_DETECTED / MOTION_CLEARED)
     ▼
MMM-MotionControl  ──►  CECControl on/off   (turn the TV on/off)
     ├────────────►  MOTION_WAKE + GET_LOGGED_IN_USERS   (motion starts: wake face recognition)
     └────────────►  MOTION_CLEARED                      (motion stops: face recognition can stand down)
```

**Presence model.** The three sources are OR-ed together. The moment _any_ of them is active the TV is switched **on**; it is switched **off** only after `delay` has elapsed with _all_ of them quiet, tracked by a single shared timer. Repeated "on" is de-duplicated, so `CECControl` only fires on real transitions.

**Motion wakes, face keeps alive.** Detecting movement is far cheaper than running face recognition all the time, so camera motion is the "gate": when motion starts it instantly turns the TV on and wakes the face-recognition modules (`MOTION_WAKE` + a fresh `GET_LOGGED_IN_USERS` scan). Once someone is actually recognized, _their_ presence keeps the TV on even after they stop moving. When motion stops, `MOTION_CLEARED` lets those modules stand back down.

**Lightweight by design.** Motion analysis runs on a tiny low-resolution stream at a low frame rate. On a Raspberry Pi Camera it uses `rpicam-vid`'s built-in `motion_detect` stage (hardware-assisted, very low CPU) — the recommended path. A USB webcam is supported as a fallback via `ffmpeg` scene-change detection, which costs noticeably more CPU.

You don't need all three sources — the module works with camera motion alone, face recognition alone, `ontime` alone, or any combination.

## Requirements

- A running [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror) instance (Node 18 or newer).
- [MMM-CECControl](https://github.com/nischi/MMM-CECControl) installed — this module tells it to switch the TV over HDMI-CEC.
- At least one presence source:
  - **Raspberry Pi Camera / CSI** → `rpicam-apps` (`rpicam-vid`), usually preinstalled on Raspberry Pi OS Bookworm — install it with `sudo apt install rpicam-apps` if it is missing. _Recommended, lowest CPU._
  - **USB webcam** → `ffmpeg` (`sudo apt install ffmpeg`). Software-decoded, so materially heavier than the Pi Camera — keep the resolution/frame rate low.
  - **Face recognition (optional)** → [MMM-Facial-Recognition-OCV3](https://github.com/normyx/MMM-Facial-Recognition-OCV3) and/or [MMM-Face-Reco-DNN](https://github.com/nischi/MMM-Face-Reco-DNN).

## Installation

1. **Install the module** into your MagicMirror:

   ```bash
   cd ~/MagicMirror/modules
   git clone https://github.com/nischi/MMM-MotionControl.git
   cd MMM-MotionControl
   npm install
   ```

2. **Install the backend for your camera** (skip if you only use face recognition or `ontime`):

   ```bash
   # Raspberry Pi Camera (CSI) — usually already present on Bookworm:
   rpicam-vid --version              # verify it is installed
   sudo apt install rpicam-apps      # only if the command was not found
   rpicam-hello --list-cameras       # verify the camera is detected

   # USB webcam:
   sudo apt install ffmpeg
   ```

3. **Configure it.** Add the module to the `modules` array in `~/MagicMirror/config/config.js`, starting from a [recipe](#setup-recipes) below.

4. **Restart MagicMirror.**

> **Tip:** before enabling the module, confirm your camera actually detects motion with the standalone tester — see [Verifying the camera](#verifying-the-camera) (Pi) or [Live camera test](#live-camera-test-no-magicmirror-needed) (any machine).

## Configuration

| Config                     | Description                                                                                                                                                  | Default            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `delay`                    | Delay (ms) before turning the TV off once every presence source is quiet.                                                                                    | `15000`            |
| `interval`                 | Poll interval (ms) for MMM-Face-Reco-DNN.                                                                                                                    | `5000`             |
| `useFacialRecognitionOCV3` | Use MMM-Facial-Recognition-OCV3 as a presence source.                                                                                                        | `false`            |
| `useMMMFaceRecoDNN`        | Use MMM-Face-Reco-DNN as a presence source.                                                                                                                  | `false`            |
| `ontime`                   | Time windows where the TV is always on, e.g. `['0700-1200', '1300-2000']` (does not span midnight).                                                          | `[]`               |
| `useCameraMotion`          | Master switch for the built-in camera motion detector.                                                                                                       | `false`            |
| `camera`                   | Capture backend: `'auto'` \| `'rpicam'` (Pi Camera / CSI) \| `'usb'` (webcam).                                                                               | `'auto'`           |
| `usbDevice`                | V4L2 device for the USB backend (and the `'auto'` fallback).                                                                                                 | `'/dev/video0'`    |
| `loresWidth`               | Low-res stream width the motion analysis runs on (rpicam).                                                                                                   | `128`              |
| `loresHeight`              | Low-res stream height (rpicam).                                                                                                                              | `96`               |
| `framerate`                | Capture frame rate for both backends. Low fps = low CPU.                                                                                                     | `5`                |
| `mainWidth`                | rpicam main stream width (discarded; kept small).                                                                                                            | `1280`             |
| `mainHeight`               | rpicam main stream height.                                                                                                                                   | `720`              |
| `motionSensitivity`        | rpicam `motion_detect` tuning (see below).                                                                                                                   | see below          |
| `sceneThreshold`           | ffmpeg `scdet` score threshold for the USB backend. Scores are small for a mostly-static webcam (idle ~0.1, deliberate motion ~0.5); lower = more sensitive. | `0.4`              |
| `usbInputFramerate`        | USB capture frame rate at the input. macOS AVFoundation only accepts modes the camera reports (usually 15/30); pin one here.                                 | `30`               |
| `usbInputSize`             | USB capture resolution at the input (`null` → `640x480` on macOS, `160x120` on Linux). The filter graph downscales to 160x120 regardless.                    | `null`             |
| `usbDebug`                 | USB: log every `scdet` score to help tune `sceneThreshold`.                                                                                                  | `false`            |
| `usbHoldMs`                | USB: how long (ms) to sustain "motion" between scene-change events.                                                                                          | `2000`             |
| `motionDebounce`           | Falling-edge debounce (ms) applied to the raw camera signal.                                                                                                 | `1500`             |
| `motionOnPattern`          | Advanced: regex (string) overriding the rpicam "motion on" log matcher.                                                                                      | `null`             |
| `motionOffPattern`         | Advanced: regex (string) overriding the rpicam "motion off" log matcher.                                                                                     | `null`             |
| `wakeNotification`         | Notification broadcast on the camera-motion rising edge (to wake other modules).                                                                             | `'MOTION_WAKE'`    |
| `clearedNotification`      | Notification broadcast on the camera-motion falling edge (after `motionDebounce`), so other modules know motion is gone. Falsy = disabled.                   | `'MOTION_CLEARED'` |

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

## Setup recipes

Pick the one that matches your setup and drop it into the `modules` array in `config.js`. Every unset option keeps its default.

**A) Motion only — the simplest (Pi Camera turns the TV on/off):**

```javascript
{
    module: 'MMM-MotionControl',
    config: {
        useCameraMotion: true,
        camera: 'rpicam',   // 'auto' also works
        delay: 15000
    }
}
```

**B) Motion + face recognition (recommended — motion wakes, face keeps alive):**

```javascript
{
    module: 'MMM-MotionControl',
    config: {
        useCameraMotion: true,
        camera: 'auto',
        useMMMFaceRecoDNN: true,      // and/or useFacialRecognitionOCV3: true
        delay: 30000
    }
}
```

**C) USB webcam instead of the Pi Camera:**

```javascript
{
    module: 'MMM-MotionControl',
    config: {
        useCameraMotion: true,
        camera: 'usb',
        usbDevice: '/dev/video0',
        sceneThreshold: 0.4           // tune with usbDebug: true
    }
}
```

**D) No camera — time windows only:**

```javascript
{
    module: 'MMM-MotionControl',
    config: {
        ontime: ['0700-0900', '1800-2300']
    }
}
```

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

# tune the USB threshold: print live scdet scores and/or set a threshold
USB_DEBUG=1 node test/live-camera.js usb
THRESHOLD=0.6 node test/live-camera.js usb
```

Move in front of the camera; you'll see `🟢 MOTION DETECTED` / `⚪️ motion cleared`. Press Ctrl+C to stop. On macOS the first run triggers a camera-permission prompt for your terminal. If nothing triggers, run with `USB_DEBUG=1` to watch the scores and pick a `sceneThreshold` just above the idle level.

### Annotated recording (visual confirmation)

To _see_ the events on the video, record a short clip with a red border drawn over every `MOTION_DETECTED…MOTION_CLEARED` interval (uses the real hold/debounce logic):

```bash
npm run test:record                 # 15s clip → motion-events.mp4
SECONDS=20 node test/record-events.js 0   # 20s, device 0
```

It writes `motion-events.mp4` (git-ignored) — open it to confirm detection lines up with real movement.

## Screenshot

There is nothing to screenshot — the module has no UI and only reacts to events to turn the TV on and off.

## License

MIT © Thierry Nischelwitzer

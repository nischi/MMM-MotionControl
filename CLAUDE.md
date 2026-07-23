# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror) module. It is not a standalone app — it runs _inside_ a MagicMirror instance. The client part is loaded in the browser/Electron renderer via the global `Module.register`; globals like `Log`, `MM`, and the notification bus (`sendNotification`/`notificationReceived`) are provided by the MagicMirror runtime. The server part (`node_helper.js`) runs in Node under the MagicMirror process.

The module has no UI. It turns a TV on/off (via [MMM-CECControl](https://github.com/nischi/MMM-CECControl)) based on presence. Presence comes from its own lightweight camera motion detector and/or external face-recognition modules.

## Architecture

Two files:

- **`MMM-MotionControl.js`** (client) — a presence state machine. It merges three independent presence sources onto a single shared off-timer (`this.offTimer`):
  - **Camera motion** — `MOTION_DETECTED` / `MOTION_CLEARED` socket notifications from our `node_helper` (`setCameraMotion`). The rising edge also calls `wakeFaceRecognition()` (emits `GET_LOGGED_IN_USERS` + the configurable `wakeNotification`, default `MOTION_WAKE`); the falling edge calls `notifyMotionCleared()` (broadcasts the configurable `clearedNotification`, default `MOTION_CLEARED`, on the module bus). Note the module-bus `MOTION_CLEARED` broadcast and the internal socket `MOTION_CLEARED` are different channels that happen to share a name.
  - **Face recognition** — `CURRENT_USER` (MMM-Facial-Recognition-OCV3) and `LOGGED_IN_USERS` (MMM-Face-Reco-DNN), each gated by a `config.useXxx` flag, folded into `setFacePresent`. DNN is polled via `GET_LOGGED_IN_USERS` on `config.interval` (`this.pollTimer`).
  - **`ontime` windows** — `inOnTime()` checks whether now falls in any `'HHMM-HHMM'` range (native `Date`; does not span midnight).
  - `evaluatePresence()` computes `present = inOnTime() || cameraMotion || facePresent`, runs on every input change and a 1s tick, and drives `setTv('on'|'off')`. `setTv` de-dupes against `this.tvState` so `CECControl` is only emitted on real transitions. The TV goes off only after `config.delay` with every source quiet.

- **`node_helper.js`** (server) — owns the camera subprocess. Backend selected by `config.camera` (`'auto' | 'rpicam' | 'usb'`):
  - **rpicam** — spawns `rpicam-vid` with the native `motion_detect` post-processing stage on a low-res stream; the effective stage JSON is built from `config.motionSensitivity` at spawn (the shipped `motion_detect.json` mirrors the defaults for manual testing). Parses `Motion detected` / `Motion stopped` on the child's **stderr** (matchers overridable via `motionOnPattern`/`motionOffPattern`).
  - **usb** — spawns `ffmpeg` with the `scdet` scene-change filter; edges are turned into a sustained state via a `usbHoldMs` window.
  - Both funnel through `setMotion()` (rising edge immediate, falling edge debounced by `motionDebounce`). Crashes respawn with backoff, capped at `MAX_FAILURES` before emitting `MOTION_BACKEND_ERROR`. Lifecycle is driven by `CONFIG` / `START_MOTION` / `STOP_MOTION` socket notifications from the client's `start()` / `stop()`.

When adding a new presence source, add a `config.useXxx` flag and fold it into `setFacePresent`/`setCameraMotion` → `evaluatePresence`; do not add a parallel off-timer.

## Tooling

- **No build step.** `npm test` runs `lint` + `format:check` + `test:unit`. Unit tests (`node --test test/*.test.js`, built-in runner, no deps) cover the pure logic: the client presence state machine and the node_helper signal conditioning (parse/gate/debounce). They load the real source via `test/harness.js`, which stubs the MagicMirror `Module`/`Log` globals and the `node_helper`/`logger` requires, and drive time with `node:test` mock timers — no camera or MagicMirror needed. The camera _capture_ itself is hardware-dependent: verify with `npm run test:camera` (`test/live-camera.js`, runs the real backend and prints motion events) or on-device (README "Verifying the camera"). Support files under `test/` that are not `*.test.js` (harness, live-camera) are deliberately excluded from the runner glob so they aren't executed as tests.
- **Lint:** ESLint 9 flat config in `eslint.config.js` (`npm run lint`). The client file gets MagicMirror renderer globals; `node_helper.js` gets Node globals. `eslint-config-prettier` is spread last so ESLint checks correctness only.
- **Formatting:** Prettier 3, single config `.prettierrc.json` (`tabWidth: 2`, `singleQuote: true`, `trailingComma: es5`). Run `npm run format` to apply, `npm run format:check` to verify. CI runs `npm test` via `.github/workflows/lint.yml`.

## Config

Defaults live in the `defaults` object at the top of `MMM-MotionControl.js`; the README documents each option for end users. Keep the two in sync when changing config. Camera/sensitivity keys are forwarded to `node_helper.js` via the `CONFIG` socket message.

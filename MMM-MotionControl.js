/* Magic Mirror
 * Module: MMM-MotionControl
 *
 * By Thierry Nischelwitzer http://nischi.ch
 * MIT Licensed.
 *
 * A background hub that turns a TV on/off (via MMM-CECControl) based on
 * presence. Presence can come from three independent sources, merged with a
 * single shared off-timer:
 *   - camera motion (this module's own node_helper, rpicam / ffmpeg)
 *   - face recognition (MMM-Facial-Recognition-OCV3 / MMM-Face-Reco-DNN)
 *   - `ontime` windows that force the TV on
 * Motion wakes the (expensive) face recognition; face presence then keeps the
 * TV alive. The TV only turns off after `delay` once every source is quiet.
 */

Module.register('MMM-MotionControl', {
  defaults: {
    // Delay (ms) before turning the TV off once presence is lost.
    delay: 15000,
    // Poll interval (ms) for MMM-Face-Reco-DNN.
    interval: 5000,

    // --- Presence sources: face recognition ---
    useFacialRecognitionOCV3: false,
    useMMMFaceRecoDNN: false,

    // Time windows where the TV is forced on, e.g. ['0700-1200', '1300-2000'].
    ontime: [],

    // --- Presence source: camera motion (handled by node_helper) ---
    useCameraMotion: false,
    // Capture backend: 'auto' | 'rpicam' (Pi Camera / CSI) | 'usb' (webcam).
    camera: 'auto',
    // V4L2 device for the USB backend (and the 'auto' probe fallback).
    usbDevice: '/dev/video0',
    // Low-res stream the motion analysis runs on (rpicam). Small = cheap.
    loresWidth: 128,
    loresHeight: 96,
    // Capture frame rate for both backends. Low fps = low CPU.
    framerate: 5,
    // rpicam main stream (discarded to /dev/null; kept small).
    mainWidth: 1280,
    mainHeight: 720,
    // rpicam motion_detect sensitivity (see README "Tuning sensitivity").
    motionSensitivity: {
      regionThreshold: 0.005,
      differenceM: 0.1,
      differenceC: 10,
      framePeriod: 5,
      roi: [0.0, 0.0, 1.0, 1.0],
    },
    // ffmpeg scdet score threshold for the USB backend. The score is small for
    // a mostly-static webcam (idle ~0.1, deliberate motion ~0.5); lower = more
    // sensitive. Tune with `usbDebug: true` (prints live scores to the log).
    sceneThreshold: 0.4,
    // USB capture mode. AVFoundation (macOS) rejects unsupported modes, so the
    // input is pinned; V4L2 (Linux) also honours usbInputSize. The filter graph
    // downscales to 160x120 and drops to `framerate` fps regardless.
    usbInputFramerate: 30,
    usbInputSize: null, // null → 640x480 on macOS, 160x120 on Linux
    // USB: log per-frame scdet scores so `sceneThreshold` can be tuned.
    usbDebug: false,
    // USB: how long (ms) to sustain "motion" between scene-change events.
    usbHoldMs: 2000,
    // Falling-edge debounce (ms) applied to the raw camera signal.
    motionDebounce: 1500,
    // Advanced: override the rpicam log matchers (regex source strings).
    motionOnPattern: null,
    motionOffPattern: null,

    // Broadcast on the camera-motion rising edge to wake other modules.
    wakeNotification: 'MOTION_WAKE',
    // Broadcast on the camera-motion falling edge (after motionDebounce) so
    // other modules (e.g. face recognition) know motion is gone. Set to a
    // falsy value to disable.
    clearedNotification: 'MOTION_CLEARED',
  },

  // --- runtime state ---
  offTimer: null,
  pollTimer: null,
  tickTimer: null,
  cameraMotion: false,
  facePresent: false,
  tvState: null,

  getScripts: function () {
    return [];
  },

  start: function () {
    Log.info(this.name + ' started');

    this.offTimer = null;
    this.pollTimer = null;
    this.tickTimer = null;
    this.cameraMotion = false;
    this.facePresent = false;
    this.tvState = null;

    // Poll MMM-Face-Reco-DNN for the currently logged-in users.
    if (this.config.useMMMFaceRecoDNN === true) {
      this.pollTimer = setInterval(() => {
        this.sendNotification('GET_LOGGED_IN_USERS');
      }, this.config.interval);
    }

    // Start the camera motion backend in the node_helper.
    if (this.config.useCameraMotion === true) {
      this.sendSocketNotification('CONFIG', this.config);
      this.sendSocketNotification('START_MOTION');
    }

    // Re-evaluate once per second so `ontime` windows and the off-timer stay
    // live even when no notifications are arriving.
    this.tickTimer = setInterval(() => {
      this.evaluatePresence();
    }, 1000);
  },

  stop: function () {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.offTimer) {
      clearTimeout(this.offTimer);
      this.offTimer = null;
    }
    if (this.config.useCameraMotion === true) {
      this.sendSocketNotification('STOP_MOTION');
    }
  },

  // True when the current wall-clock time falls inside any `ontime` window.
  // Windows are 'HHMM-HHMM' within a single day (they do not span midnight).
  inOnTime: function () {
    const now = new Date();
    const minutesNow = now.getHours() * 60 + now.getMinutes();

    return this.config.ontime.some((time) => {
      const parts = time.split('-');
      if (parts.length !== 2) {
        return false;
      }
      const from =
        parseInt(parts[0].substr(0, 2), 10) * 60 +
        parseInt(parts[0].substr(2, 2), 10);
      const to =
        parseInt(parts[1].substr(0, 2), 10) * 60 +
        parseInt(parts[1].substr(2, 2), 10);

      return minutesNow >= from && minutesNow < to;
    });
  },

  // Face-recognition presence from the two supported source modules.
  notificationReceived: function (notification, payload) {
    if (
      this.config.useFacialRecognitionOCV3 === true &&
      notification === 'CURRENT_USER'
    ) {
      this.setFacePresent(payload !== 'None');
    }

    if (
      this.config.useMMMFaceRecoDNN === true &&
      notification === 'LOGGED_IN_USERS'
    ) {
      this.setFacePresent(Array.isArray(payload) && payload.length > 0);
    }
  },

  // Camera motion presence from our node_helper.
  socketNotificationReceived: function (notification, payload) {
    if (notification === 'MOTION_DETECTED') {
      this.setCameraMotion(true);
    } else if (notification === 'MOTION_CLEARED') {
      this.setCameraMotion(false);
    } else if (notification === 'MOTION_BACKEND_ERROR') {
      Log.error(this.name + ' motion backend error: ' + payload);
    }
  },

  setFacePresent: function (present) {
    if (this.facePresent === present) {
      return;
    }
    this.facePresent = present;
    this.evaluatePresence();
  },

  setCameraMotion: function (motion) {
    if (this.cameraMotion === motion) {
      return;
    }
    this.cameraMotion = motion;
    if (motion === true) {
      // Rising edge: wake face recognition. It then keeps the TV alive.
      this.wakeFaceRecognition();
    } else {
      // Falling edge: tell other modules motion is gone.
      this.notifyMotionCleared();
    }
    this.evaluatePresence();
  },

  wakeFaceRecognition: function () {
    if (this.config.useMMMFaceRecoDNN === true) {
      // Force an out-of-band scan instead of waiting for the next poll.
      this.sendNotification('GET_LOGGED_IN_USERS');
    }
    if (this.config.wakeNotification) {
      this.sendNotification(this.config.wakeNotification);
    }
  },

  notifyMotionCleared: function () {
    if (this.config.clearedNotification) {
      this.sendNotification(this.config.clearedNotification);
    }
  },

  // Merge all presence sources onto one shared off-timer.
  evaluatePresence: function () {
    const present = this.inOnTime() || this.cameraMotion || this.facePresent;

    if (present) {
      if (this.offTimer) {
        clearTimeout(this.offTimer);
        this.offTimer = null;
      }
      this.setTv('on');
    } else if (this.offTimer === null && this.tvState !== 'off') {
      this.offTimer = setTimeout(() => {
        this.offTimer = null;
        this.setTv('off');
      }, this.config.delay);
    }
  },

  // Only emit CECControl when the desired state actually changes.
  setTv: function (state) {
    if (this.tvState === state) {
      return;
    }
    this.tvState = state;
    Log.info(this.name + ' -> CECControl ' + state);
    this.sendNotification('CECControl', state);
  },
});

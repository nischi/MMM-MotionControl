/* Standalone live camera test — no MagicMirror required.
 *
 * Runs the real node_helper against your actual camera and prints motion
 * events to the terminal, so you can confirm detection works (and tune
 * sensitivity) before wiring the module into MagicMirror.
 *
 * Usage:
 *   node test/live-camera.js                 # auto-detect backend
 *   node test/live-camera.js usb             # force the USB / webcam backend
 *   node test/live-camera.js rpicam          # force the Pi Camera backend
 *   node test/live-camera.js usb 1           # USB, device index/path "1"
 *
 * Requirements:
 *   - rpicam backend: rpicam-apps (rpicam-vid) on a Raspberry Pi.
 *   - usb backend: ffmpeg (macOS: `brew install ffmpeg`, Linux: apt).
 *
 * Press Ctrl+C to stop.
 */

const Module = require('node:module');

// Give node_helper a console-backed logger and a stub NodeHelper base so we can
// load it outside MagicMirror.
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'logger') {
    return {
      info: (...a) => console.log('[info]', ...a),
      warn: (...a) => console.warn('[warn]', ...a),
      error: (...a) => console.error('[error]', ...a),
      log: (...a) => console.log(...a),
    };
  }
  if (request === 'node_helper') {
    return { create: (proto) => Object.assign({}, proto) };
  }
  return origLoad.call(this, request, parent, isMain);
};

const helper = require('../node_helper.js');

const backend = process.argv[2]; // 'usb' | 'rpicam' | undefined (auto)
const device = process.argv[3]; // optional device override

const config = {
  camera: backend || 'auto',
  usbDevice: device || (process.platform === 'darwin' ? '0' : '/dev/video0'),
  framerate: 5,
  loresWidth: 128,
  loresHeight: 96,
  mainWidth: 1280,
  mainHeight: 720,
  motionSensitivity: {
    regionThreshold: 0.005,
    differenceM: 0.1,
    differenceC: 10,
    framePeriod: 5,
    roi: [0.0, 0.0, 1.0, 1.0],
  },
  sceneThreshold: 12,
  usbHoldMs: 2000,
  motionDebounce: 1500,
  motionOnPattern: null,
  motionOffPattern: null,
};

const stamp = () => new Date().toISOString().substr(11, 8);

helper.sendSocketNotification = (notification, payload) => {
  if (notification === 'MOTION_DETECTED') {
    console.log(`\n[${stamp()}] 🟢 MOTION DETECTED\n`);
  } else if (notification === 'MOTION_CLEARED') {
    console.log(`\n[${stamp()}] ⚪️ motion cleared\n`);
  } else if (notification === 'MOTION_BACKEND_ERROR') {
    console.error(`\n[${stamp()}] ❌ backend error: ${payload}\n`);
  }
};

helper.start();
console.log(
  `Starting motion detection (backend: ${config.camera}, platform: ${process.platform}). Move in front of the camera. Ctrl+C to stop.\n`
);
helper.socketNotificationReceived('CONFIG', config);
helper.socketNotificationReceived('START_MOTION');

process.on('SIGINT', () => {
  console.log('\nStopping…');
  helper.socketNotificationReceived('STOP_MOTION');
  process.exit(0);
});

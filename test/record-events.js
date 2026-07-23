/* Record an annotated clip that visually confirms the motion events.
 *
 * Two passes, no MagicMirror required:
 *   1. Capture the webcam to a raw clip while the REAL node_helper logic
 *      (scdet parsing + hold + debounce) decides when motion is present.
 *      Each MOTION_DETECTED / MOTION_CLEARED is timestamped against the clip.
 *   2. Re-encode the clip with a red border drawn over every
 *      MOTION_DETECTED..MOTION_CLEARED interval (drawbox — no font needed).
 *
 * Usage:
 *   node test/record-events.js                 # 15s, device 0
 *   SECONDS=20 node test/record-events.js 0    # 20s, device 0
 *   THRESHOLD=0.6 OUT_DIR=/tmp node test/record-events.js
 *
 * Requires ffmpeg (macOS: `brew install ffmpeg`). Ctrl+C stops early.
 */

const Module = require('node:module');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');

// Load node_helper outside MagicMirror (stub logger + NodeHelper base).
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'logger') {
    return { info() {}, warn() {}, error() {}, log() {} };
  }
  if (request === 'node_helper') {
    return { create: (proto) => Object.assign({}, proto) };
  }
  return origLoad.call(this, request, parent, isMain);
};

const helper = require('../node_helper.js');
helper.start();

const THRESHOLD = process.env.THRESHOLD ? Number(process.env.THRESHOLD) : 0.4;
const DURATION = process.env.SECONDS ? Number(process.env.SECONDS) : 15;
const DEVICE =
  process.argv[2] || (process.platform === 'darwin' ? '0' : '/dev/video0');
const OUT_DIR = process.env.OUT_DIR || '.';
const rawFile = path.join(OUT_DIR, 'motion-raw.mp4');
const outFile = path.join(OUT_DIR, 'motion-events.mp4');

// Reuse the real signal-conditioning (hold + debounce), just faster for a demo.
helper.config = {
  sceneThreshold: THRESHOLD,
  usbHoldMs: 1500,
  motionDebounce: 800,
};

const events = [];
let started = null;
const clipTime = () => (started == null ? 0 : (Date.now() - started) / 1000);

helper.sendSocketNotification = (notification) => {
  if (notification === 'MOTION_DETECTED') {
    events.push({ state: 'on', t: clipTime() });
    console.log(`[${clipTime().toFixed(1)}s] 🟢 MOTION DETECTED`);
  } else if (notification === 'MOTION_CLEARED') {
    events.push({ state: 'off', t: clipTime() });
    console.log(`[${clipTime().toFixed(1)}s] ⚪️  motion cleared`);
  }
};

const inputArgs =
  process.platform === 'darwin'
    ? [
        '-f',
        'avfoundation',
        '-framerate',
        '30',
        '-video_size',
        '640x480',
        '-i',
        DEVICE,
      ]
    : [
        '-f',
        'v4l2',
        '-framerate',
        '30',
        '-video_size',
        '640x480',
        '-i',
        DEVICE,
      ];

console.log(
  `Recording ${DURATION}s from device "${DEVICE}" (threshold ${THRESHOLD}). Move in front of the camera…\n`
);

const pass1 = spawn(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'info',
    ...inputArgs,
    '-vf',
    `fps=10,scdet=threshold=${THRESHOLD},metadata=print:file=-`,
    '-t',
    String(DURATION),
    '-y',
    rawFile,
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] }
);
started = Date.now();

const onLine = (line) => helper.handleLine(line, 'usb');
readline.createInterface({ input: pass1.stdout }).on('line', onLine);
readline.createInterface({ input: pass1.stderr }).on('line', onLine);

pass1.on('error', (err) => {
  console.error('ffmpeg failed to start:', err.message);
  process.exit(1);
});

pass1.on('exit', () => {
  // Pair events into [start, end] intervals; close a dangling one at clip end.
  const intervals = [];
  let open = null;
  for (const e of events) {
    if (e.state === 'on' && open == null) {
      open = e.t;
    } else if (e.state === 'off' && open != null) {
      intervals.push([open, e.t]);
      open = null;
    }
  }
  if (open != null) {
    intervals.push([open, DURATION]);
  }

  console.log(`\nCaptured ${intervals.length} motion interval(s).`);
  const enable = intervals.length
    ? intervals
        .map(([a, b]) => `between(t,${a.toFixed(2)},${b.toFixed(2)})`)
        .join('+')
    : '0';
  const vf = `drawbox=x=0:y=0:w=iw:h=ih:t=18:color=red@0.9:enable='${enable}'`;

  const pass2 = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      rawFile,
      '-vf',
      vf,
      '-y',
      outFile,
    ],
    { stdio: 'inherit' }
  );
  pass2.on('exit', (code) => {
    console.log(`\n✅ Annotated video written to: ${outFile}`);
    console.log(
      '   A red border marks every MOTION_DETECTED…MOTION_CLEARED period.'
    );
    process.exit(code || 0);
  });
});

process.on('SIGINT', () => {
  pass1.kill('SIGINT');
});

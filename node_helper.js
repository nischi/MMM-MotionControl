/* Magic Mirror
 * Node Helper: MMM-MotionControl
 *
 * By Thierry Nischelwitzer http://nischi.ch
 * MIT Licensed.
 *
 * Owns the camera motion-detection subprocess and translates its output into
 * MOTION_DETECTED / MOTION_CLEARED socket notifications for the client module.
 *
 *   rpicam backend (Pi Camera / CSI): rpicam-vid with the native
 *     `motion_detect` post-processing stage on a low-res stream. Very low CPU.
 *   usb backend (UVC webcam): ffmpeg V4L2 capture with the `scdet`
 *     scene-change filter. Heavier than rpicam; kept small on purpose.
 *
 * Both backends funnel through setMotion() so the client sees identical
 * semantics regardless of which camera is in use.
 */

const NodeHelper = require('node_helper');
const Log = require('logger');
const { spawn, execFile } = require('node:child_process');
const readline = require('node:readline');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_FAILURES = 5;

module.exports = NodeHelper.create({
  start: function () {
    this.config = null;
    this.child = null;
    this.backend = null;
    this.running = false;
    this.motionActive = false;
    this.clearTimer = null;
    this.usbHoldTimer = null;
    this.restartTimer = null;
    this.failureCount = 0;
    Log.info('MMM-MotionControl node_helper started');

    // Best-effort orphan cleanup if MagicMirror exits.
    process.on('exit', () => {
      if (this.child) {
        try {
          this.child.kill('SIGTERM');
        } catch {
          // ignore
        }
      }
    });
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === 'CONFIG') {
      this.config = payload;
    } else if (notification === 'START_MOTION') {
      this.running = true;
      this.failureCount = 0;
      this.startBackend();
    } else if (notification === 'STOP_MOTION') {
      this.running = false;
      this.stopBackend();
    }
  },

  startBackend: function () {
    if (this.child) {
      return; // already running (idempotent)
    }
    if (!this.config) {
      Log.error('MMM-MotionControl: START_MOTION received before CONFIG');
      return;
    }

    const cam = (this.config.camera || 'auto').toLowerCase();
    if (cam === 'usb') {
      this.startUsb();
    } else if (cam === 'rpicam') {
      this.startRpicam();
    } else {
      this.probeAndStart();
    }
  },

  // 'auto': prefer the CSI camera; fall back to USB only when rpicam reports no
  // camera. Probing is best-effort and non-fatal — default to rpicam.
  probeAndStart: function () {
    execFile(
      'rpicam-hello',
      ['--list-cameras', '--timeout', '1'],
      { timeout: 4000 },
      (err, stdout) => {
        if (!this.running || this.child) {
          return;
        }
        if (!err && /available cameras/i.test(stdout || '')) {
          this.startRpicam();
        } else {
          Log.info(
            'MMM-MotionControl: no CSI camera detected, using USB backend'
          );
          this.startUsb();
        }
      }
    );
  },

  startRpicam: function () {
    const c = this.config;
    const s = c.motionSensitivity || {};
    const roi = s.roi || [0.0, 0.0, 1.0, 1.0];
    const pick = (value, fallback) => (value != null ? value : fallback);

    const ppConfig = {
      motion_detect: {
        roi_x: roi[0],
        roi_y: roi[1],
        roi_width: roi[2],
        roi_height: roi[3],
        difference_m: pick(s.differenceM, 0.1),
        difference_c: pick(s.differenceC, 10),
        region_threshold: pick(s.regionThreshold, 0.005),
        frame_period: pick(s.framePeriod, 5),
        hskip: 2,
        vskip: 2,
        verbose: 1,
      },
    };

    const ppFile = path.join(
      os.tmpdir(),
      'mmm-motioncontrol-motion_detect.json'
    );
    try {
      fs.writeFileSync(ppFile, JSON.stringify(ppConfig, null, 2));
    } catch (e) {
      Log.error(
        'MMM-MotionControl: cannot write post-process file: ' + e.message
      );
      this.emitError('cannot write post-process file: ' + e.message);
      return;
    }

    const args = [
      '--timeout',
      '0',
      '--nopreview',
      '--codec',
      'yuv420',
      '--width',
      String(pick(c.mainWidth, 1280)),
      '--height',
      String(pick(c.mainHeight, 720)),
      '--lores-width',
      String(pick(c.loresWidth, 128)),
      '--lores-height',
      String(pick(c.loresHeight, 96)),
      '--framerate',
      String(pick(c.framerate, 5)),
      '--post-process-file',
      ppFile,
      '--output',
      '/dev/null',
      '--flush',
      '1',
    ];

    Log.info('MMM-MotionControl: spawning rpicam-vid ' + args.join(' '));
    this.spawnChild('rpicam-vid', args, 'rpicam');
  },

  startUsb: function () {
    const c = this.config;
    const fr = c.framerate != null ? c.framerate : 5;
    const threshold = c.sceneThreshold != null ? c.sceneThreshold : 0.4;

    // Downscale + drop fps in the filter graph, run scene-change detection, and
    // print frame metadata. scdet sets `lavfi.scd.time` only when the score
    // crosses the threshold, so that line is our motion edge. Same graph on
    // every platform; only the capture input differs (V4L2 on Linux,
    // AVFoundation on macOS).
    const vf =
      'fps=' +
      fr +
      ',scale=160:120,scdet=threshold=' +
      threshold +
      ',metadata=print:file=-';

    let inputArgs;
    if (process.platform === 'darwin') {
      // AVFoundation addresses cameras by index; '0' is the default camera.
      // (A '/dev/...' path is meaningless here, so fall back to '0'.) It also
      // rejects arbitrary capture modes, so pin a mode the camera supports.
      const device =
        c.usbDevice && !c.usbDevice.startsWith('/dev/') ? c.usbDevice : '0';
      inputArgs = [
        '-f',
        'avfoundation',
        '-framerate',
        String(c.usbInputFramerate != null ? c.usbInputFramerate : 30),
        '-video_size',
        c.usbInputSize || '640x480',
        '-i',
        device,
      ];
    } else {
      const device = c.usbDevice || '/dev/video0';
      inputArgs = [
        '-f',
        'v4l2',
        '-framerate',
        String(fr),
        '-video_size',
        c.usbInputSize || '160x120',
        '-i',
        device,
      ];
    }

    const args = [
      '-hide_banner',
      '-loglevel',
      'info',
      ...inputArgs,
      '-vf',
      vf,
      '-f',
      'null',
      '-',
    ];

    Log.info('MMM-MotionControl: spawning ffmpeg ' + args.join(' '));
    this.spawnChild('ffmpeg', args, 'usb');
  },

  spawnChild: function (command, args, backend) {
    let child;
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      this.failAndMaybeRestart(command + ' spawn error: ' + e.message);
      return;
    }
    this.child = child;
    this.backend = backend;

    child.on('error', (err) => {
      this.failAndMaybeRestart(command + ' error: ' + err.message);
    });

    child.on('exit', (code, signal) => {
      this.child = null;
      if (!this.running) {
        return; // intentional stop
      }
      this.failAndMaybeRestart(
        command + ' exited (code=' + code + ', signal=' + signal + ')'
      );
    });

    // The motion_detect stage logs to stderr; parse both streams to be safe.
    const onLine = (line) => this.handleLine(line, backend);
    readline.createInterface({ input: child.stdout }).on('line', onLine);
    readline.createInterface({ input: child.stderr }).on('line', onLine);
  },

  failAndMaybeRestart: function (reason) {
    this.child = null;
    this.failureCount += 1;
    if (this.failureCount >= MAX_FAILURES) {
      Log.error(
        'MMM-MotionControl: giving up after repeated failures: ' + reason
      );
      this.emitError('backend failed repeatedly: ' + reason);
      this.running = false;
      return;
    }
    Log.warn(
      'MMM-MotionControl: ' +
        reason +
        ' (attempt ' +
        this.failureCount +
        '), restarting'
    );
    this.scheduleRestart();
  },

  scheduleRestart: function () {
    if (!this.running || this.restartTimer) {
      return;
    }
    const delay = Math.min(2000 * (this.failureCount + 1), 15000);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.running) {
        this.startBackend();
      }
    }, delay);
  },

  handleLine: function (line, backend) {
    if (!line) {
      return;
    }
    if (backend === 'usb') {
      this.handleUsbLine(line);
    } else {
      this.handleRpicamLine(line);
    }
  },

  handleRpicamLine: function (line) {
    const onRe = this.config.motionOnPattern
      ? new RegExp(this.config.motionOnPattern, 'i')
      : /motion detected|motion:?\s*(?:true|1)\b/i;
    const offRe = this.config.motionOffPattern
      ? new RegExp(this.config.motionOffPattern, 'i')
      : /motion stopped|no motion|motion:?\s*(?:false|0)\b/i;

    if (offRe.test(line)) {
      this.failureCount = 0;
      this.setMotion(false);
    } else if (onRe.test(line)) {
      this.failureCount = 0;
      this.setMotion(true);
    }
  },

  handleUsbLine: function (line) {
    // With usbDebug on, echo the per-frame score so a threshold can be tuned.
    if (this.config.usbDebug && /scd\.score/i.test(line)) {
      Log.info('MMM-MotionControl: ' + line.trim());
    }
    // scdet sets `lavfi.scd.time` only on a detected scene change — one line
    // per motion edge. (`lavfi.scd.score` is printed every frame; ignore it.)
    if (/scd\.time/i.test(line)) {
      this.failureCount = 0;
      this.registerUsbActivity();
    }
  },

  // A USB scene change is an edge, not a sustained state. Re-arm a hold window
  // on each change so the client sees a continuous "motion present" period.
  registerUsbActivity: function () {
    this.setMotion(true);
    if (this.usbHoldTimer) {
      clearTimeout(this.usbHoldTimer);
    }
    const hold = this.config.usbHoldMs != null ? this.config.usbHoldMs : 2000;
    this.usbHoldTimer = setTimeout(() => {
      this.usbHoldTimer = null;
      this.setMotion(false);
    }, hold);
  },

  // Single gate for both backends. Rising edge fires immediately; falling edge
  // is debounced to smooth flicker (and to cover rpicam versions that only log
  // the "detected" transition).
  setMotion: function (active) {
    if (active) {
      if (this.clearTimer) {
        clearTimeout(this.clearTimer);
        this.clearTimer = null;
      }
      if (!this.motionActive) {
        this.motionActive = true;
        this.sendSocketNotification('MOTION_DETECTED');
      }
    } else {
      if (!this.motionActive || this.clearTimer) {
        return;
      }
      const debounce =
        this.config.motionDebounce != null ? this.config.motionDebounce : 1500;
      this.clearTimer = setTimeout(() => {
        this.clearTimer = null;
        this.motionActive = false;
        this.sendSocketNotification('MOTION_CLEARED');
      }, debounce);
    }
  },

  stopBackend: function () {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    if (this.usbHoldTimer) {
      clearTimeout(this.usbHoldTimer);
      this.usbHoldTimer = null;
    }
    if (this.child) {
      try {
        this.child.kill('SIGTERM');
      } catch {
        // ignore
      }
      this.child = null;
    }
    this.motionActive = false;
  },

  emitError: function (message) {
    this.sendSocketNotification('MOTION_BACKEND_ERROR', message);
  },
});

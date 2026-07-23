/* Unit tests for the node_helper signal conditioning: log parsing, the
 * rising/falling-edge gate, and the falling-edge debounce. These exercise the
 * real node_helper.js with the camera subprocess bypassed (we feed log lines
 * directly). */

const { test, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { loadNodeHelper } = require('./harness');

function setup(configOverrides) {
  const { helper, sent } = loadNodeHelper();
  helper.config = Object.assign(
    { motionDebounce: 1500 },
    configOverrides || {}
  );
  return { helper, sent };
}

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout'] });
});

afterEach(() => {
  mock.timers.reset();
});

test('rpicam "Motion detected" line emits MOTION_DETECTED once', () => {
  const { helper, sent } = setup();
  helper.handleLine('... Motion detected', 'rpicam');
  helper.handleLine('... Motion detected', 'rpicam'); // sustained, no re-emit

  assert.deepStrictEqual(
    sent.map((s) => s.notification),
    ['MOTION_DETECTED']
  );
});

test('rpicam clear is debounced before MOTION_CLEARED', () => {
  const { helper, sent } = setup({ motionDebounce: 1500 });
  helper.handleLine('Motion detected', 'rpicam');
  sent.length = 0;

  helper.handleLine('Motion stopped', 'rpicam');
  mock.timers.tick(1000);
  assert.deepStrictEqual(sent, [], 'not cleared before the debounce elapses');

  mock.timers.tick(600);
  assert.deepStrictEqual(
    sent.map((s) => s.notification),
    ['MOTION_CLEARED']
  );
});

test('motion returning during the debounce window cancels the clear', () => {
  const { helper, sent } = setup({ motionDebounce: 1500 });
  helper.handleLine('Motion detected', 'rpicam');
  helper.handleLine('Motion stopped', 'rpicam');
  mock.timers.tick(1000);
  helper.handleLine('Motion detected', 'rpicam'); // back before debounce fires
  sent.length = 0;

  mock.timers.tick(2000);
  assert.deepStrictEqual(sent, [], 'no MOTION_CLEARED; still active');
});

test('custom motionOnPattern / motionOffPattern override the matchers', () => {
  const { helper, sent } = setup({
    motionDebounce: 0,
    motionOnPattern: 'ALARM_ON',
    motionOffPattern: 'ALARM_OFF',
  });
  helper.handleLine('sensor: ALARM_ON now', 'rpicam');
  helper.handleLine('sensor: ALARM_OFF now', 'rpicam');
  mock.timers.tick(1);

  assert.deepStrictEqual(
    sent.map((s) => s.notification),
    ['MOTION_DETECTED', 'MOTION_CLEARED']
  );
});

test('USB scene-change edges sustain a single motion period', () => {
  const { helper, sent } = setup({ usbHoldMs: 2000, motionDebounce: 500 });

  // Two scene changes 1s apart → one continuous "motion" period.
  helper.handleLine('lavfi.scd.time=1.0', 'usb');
  mock.timers.tick(1000);
  helper.handleLine('lavfi.scd.time=2.0', 'usb'); // re-arms the hold window

  assert.deepStrictEqual(
    sent.map((s) => s.notification),
    ['MOTION_DETECTED'],
    'only one detected edge so far'
  );

  // Hold window (2000) lapses → the falling edge starts the debounce.
  mock.timers.tick(2000);
  assert.deepStrictEqual(
    sent.map((s) => s.notification),
    ['MOTION_DETECTED'],
    'debounce started, not cleared yet'
  );

  // Debounce (500) then lapses with no further changes → cleared.
  mock.timers.tick(600);
  assert.deepStrictEqual(
    sent.map((s) => s.notification),
    ['MOTION_DETECTED', 'MOTION_CLEARED']
  );
});

test('USB per-frame score lines do not trigger motion', () => {
  const { helper, sent } = setup();
  helper.handleLine('lavfi.scd.score=0.42', 'usb'); // every-frame noise
  helper.handleLine('frame:12 pts:400', 'usb');
  assert.deepStrictEqual(sent, []);
});

test('repeated spawn failures give up and emit MOTION_BACKEND_ERROR', () => {
  const { helper, sent } = setup();
  helper.running = true;
  for (let i = 0; i < 6; i++) {
    helper.failAndMaybeRestart('boom');
    mock.timers.tick(20000); // let any scheduled restart fire
  }
  assert.ok(
    sent.some((s) => s.notification === 'MOTION_BACKEND_ERROR'),
    'surfaces a backend error'
  );
  assert.strictEqual(helper.running, false, 'stops trying');
});

/* Unit tests for the client presence state machine (MMM-MotionControl.js). */

const { test, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { loadClientModule, withConfig } = require('./harness');

function names(list) {
  return list.map((n) => n.notification);
}

function cecPayloads(list) {
  return list
    .filter((n) => n.notification === 'CECControl')
    .map((n) => n.payload);
}

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
});

afterEach(() => {
  mock.timers.reset();
});

test('camera motion turns the TV on exactly once and wakes face recognition', () => {
  const { mod, notifications } = loadClientModule();
  withConfig(mod, { useMMMFaceRecoDNN: true, delay: 15000 });
  mod.start();
  notifications.length = 0;

  mod.socketNotificationReceived('MOTION_DETECTED');
  mod.socketNotificationReceived('MOTION_DETECTED'); // duplicate, ignored

  assert.deepStrictEqual(cecPayloads(notifications), ['on']);
  assert.ok(names(notifications).includes('MOTION_WAKE'), 'broadcasts wake');
  assert.ok(
    names(notifications).includes('GET_LOGGED_IN_USERS'),
    'forces a DNN scan'
  );
});

test('TV turns off only after delay once motion clears', () => {
  const { mod, notifications } = loadClientModule();
  withConfig(mod, { delay: 15000 });
  mod.start();

  mod.socketNotificationReceived('MOTION_DETECTED');
  notifications.length = 0;
  mod.socketNotificationReceived('MOTION_CLEARED');

  // Not off yet.
  mock.timers.tick(14000);
  assert.deepStrictEqual(cecPayloads(notifications), []);

  // Off after the full delay.
  mock.timers.tick(2000);
  assert.deepStrictEqual(cecPayloads(notifications), ['off']);
});

test('face presence keeps the TV on after motion clears', () => {
  const { mod, notifications } = loadClientModule();
  withConfig(mod, { useMMMFaceRecoDNN: true, delay: 15000 });
  mod.start();

  mod.socketNotificationReceived('MOTION_DETECTED');
  mod.notificationReceived('LOGGED_IN_USERS', ['alice']); // recognized
  notifications.length = 0;

  mod.socketNotificationReceived('MOTION_CLEARED'); // motion gone, face remains
  mock.timers.tick(20000);
  assert.deepStrictEqual(
    cecPayloads(notifications),
    [],
    'stays on while a face is present'
  );

  // Now the face leaves too → off after delay.
  mod.notificationReceived('LOGGED_IN_USERS', []);
  mock.timers.tick(16000);
  assert.deepStrictEqual(cecPayloads(notifications), ['off']);
});

test('re-appearing motion during the off delay cancels the off', () => {
  const { mod, notifications } = loadClientModule();
  withConfig(mod, { delay: 15000 });
  mod.start();

  mod.socketNotificationReceived('MOTION_DETECTED');
  mod.socketNotificationReceived('MOTION_CLEARED');
  mock.timers.tick(10000);
  mod.socketNotificationReceived('MOTION_DETECTED'); // back within the delay
  notifications.length = 0;

  mock.timers.tick(20000);
  assert.deepStrictEqual(
    cecPayloads(notifications),
    [],
    'no off emitted; still present'
  );
});

test('OCV3 "None" payload means nobody present', () => {
  const { mod, notifications } = loadClientModule();
  withConfig(mod, { useFacialRecognitionOCV3: true, delay: 15000 });
  mod.start();

  mod.notificationReceived('CURRENT_USER', 'thierry');
  assert.deepStrictEqual(cecPayloads(notifications), ['on']);

  notifications.length = 0;
  mod.notificationReceived('CURRENT_USER', 'None');
  mock.timers.tick(16000);
  assert.deepStrictEqual(cecPayloads(notifications), ['off']);
});

test('ontime window forces the TV on regardless of presence', () => {
  const { mod, notifications } = loadClientModule();
  withConfig(mod, { ontime: ['0000-2359'], delay: 15000 });
  mod.start();
  notifications.length = 0;

  mod.evaluatePresence();
  assert.deepStrictEqual(cecPayloads(notifications), ['on']);

  // Even after the delay, an all-day window keeps it on.
  mock.timers.tick(20000);
  assert.ok(!cecPayloads(notifications).includes('off'));
});

test('empty ontime array never forces on', () => {
  const { mod } = loadClientModule();
  withConfig(mod, { ontime: [] });
  assert.strictEqual(mod.inOnTime(), false);
});

test('malformed ontime entries are ignored', () => {
  const { mod } = loadClientModule();
  withConfig(mod, { ontime: ['garbage', '0000-2359'] });
  assert.strictEqual(mod.inOnTime(), true); // the valid all-day entry still matches
});

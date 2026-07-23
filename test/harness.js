/* Shared test harness.
 *
 * MMM-MotionControl.js and node_helper.js depend on globals/modules that only
 * exist inside a running MagicMirror. These helpers stub just enough of that
 * environment so the real source files can be loaded and exercised in plain
 * Node — no MagicMirror install required.
 */

const Module = require('node:module');

// Avoid "MaxListenersExceeded" warnings: node_helper's start() registers a
// process 'exit' listener, and tests may init several helpers.
process.setMaxListeners(0);

// Patch require() so the node_helper's `require('node_helper')` and
// `require('logger')` resolve to lightweight stubs.
let patched = false;
function patchRequire() {
  if (patched) {
    return;
  }
  patched = true;
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'logger') {
      return { info() {}, warn() {}, error() {}, log() {} };
    }
    if (request === 'node_helper') {
      return {
        create: (proto) =>
          Object.assign({ sendSocketNotification() {} }, proto),
      };
    }
    return origLoad.call(this, request, parent, isMain);
  };
}

// Load node_helper.js and return the helper object, with a captured list of the
// socket notifications it emits.
function loadNodeHelper() {
  patchRequire();
  delete require.cache[require.resolve('../node_helper.js')];
  const helper = require('../node_helper.js');
  const sent = [];
  helper.sendSocketNotification = (notification, payload) => {
    sent.push({ notification, payload });
  };
  helper.start();
  return { helper, sent };
}

// Load MMM-MotionControl.js (the client) and return the module object plus a
// captured list of the notifications it emits.
function loadClientModule() {
  const notifications = [];
  const sockets = [];
  global.Module = {
    register(name, proto) {
      global.__mmmMotionControl = proto;
    },
  };
  global.Log = { info() {}, warn() {}, error() {}, log() {} };

  delete require.cache[require.resolve('../MMM-MotionControl.js')];
  require('../MMM-MotionControl.js');
  const mod = global.__mmmMotionControl;

  mod.name = 'MMM-MotionControl';
  mod.sendNotification = (notification, payload) =>
    notifications.push({ notification, payload });
  mod.sendSocketNotification = (notification, payload) =>
    sockets.push({ notification, payload });

  return { mod, notifications, sockets };
}

// Merge defaults with overrides into mod.config, mirroring MagicMirror.
function withConfig(mod, overrides) {
  mod.config = Object.assign({}, mod.defaults, overrides || {});
  return mod;
}

module.exports = { loadNodeHelper, loadClientModule, withConfig };

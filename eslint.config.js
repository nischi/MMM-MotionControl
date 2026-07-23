/* Flat ESLint config for MMM-MotionControl.
 *
 * Correctness-only: all formatting is delegated to Prettier via
 * eslint-config-prettier (spread last). The client file runs in the
 * MagicMirror browser/Electron renderer; node_helper.js runs in Node.
 */

const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

module.exports = [
  {
    ignores: ['node_modules/**'],
  },
  js.configs.recommended,
  {
    // Client module — MagicMirror renderer globals.
    files: ['MMM-MotionControl.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        Module: 'readonly',
        Log: 'readonly',
        MM: 'readonly',
        config: 'readonly',
        moment: 'readonly',
      },
    },
  },
  {
    // Node helper, tests and config files — CommonJS running under Node.
    files: ['node_helper.js', 'eslint.config.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
  },
  prettier,
];

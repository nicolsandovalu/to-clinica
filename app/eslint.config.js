const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', 'coverage/*', '.expo/*'] },
  {
    rules: {
      // CS-07: cero datos clínicos en la consola.
      'no-console': 'error',
    },
  },
]);

const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    ignores: [
      'android/**',
      'ios/**',
      'dist/**',
      '.expo/**',
      'coverage/**',
    ],
  },
];

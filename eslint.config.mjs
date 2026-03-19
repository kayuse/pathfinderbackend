// eslint.config.mjs
import { defineConfig } from 'eslint-define-config';

export default defineConfig({
  extends: [
    'eslint:recommended',
    'plugin:prettier/recommended', // <- makes ESLint and Prettier compatible
  ],
  rules: {
    // Your custom rules here
    'prettier/prettier': ['error'],
  },
});
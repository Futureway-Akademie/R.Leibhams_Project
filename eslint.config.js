// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '.workshop/**',
      // Ins WordPress-Plugin kopiertes, gebautes Widget (pnpm wp:assets).
      'plugins/wordpress/fw-booking/assets/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // NestJS-Module sind per Konvention leere bzw. rein statische Klassen mit Decorator.
    files: ['apps/api/**', 'apps/worker/**'],
    rules: { '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }] },
  },
  {
    files: ['packages/widget/**', 'apps/portal/**', 'plugins/wordpress/fw-booking/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  { files: ['**/*.js', '**/*.mjs'], extends: [tseslint.configs.disableTypeChecked] },
  prettier,
);

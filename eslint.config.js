import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    files: ['packages/*/src/**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      // Connector interfaces deliberately return promises even when a local
      // adapter completes synchronously; preserving one async contract keeps
      // callers independent of transport choice.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', '**/*.test.ts', '**/*.js'],
  },
);

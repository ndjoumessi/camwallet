// Configuration ESLint (format eslintrc — ESLint 8 + typescript-eslint v6).
// Sans ce fichier, `npm run lint` échoue avec « couldn't find a configuration file »
// et bloque tout le pipeline CI (le job Lint est la première étape).
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: ['plugin:@typescript-eslint/recommended'],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js', 'dist'],
  rules: {
    // tsconfig volontairement permissif (cf. CLAUDE.md) : on tolère `any` et
    // les types de retour implicites, comme le veut la convention NestJS.
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    // Paramètres/variables préfixés par « _ » = volontairement inutilisés.
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
  },
};

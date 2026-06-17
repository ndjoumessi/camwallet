/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  rootDir: '..',
  testMatch: ['<rootDir>/e2e/**/*.e2e.ts'],
  testTimeout: 120000,
  maxWorkers: 1,
  globalSetup: 'detox/runners/jest/globalSetup',
  globalTeardown: 'detox/runners/jest/globalTeardown',
  reporters: ['detox/runners/jest/reporter'],
  testEnvironment: 'detox/runners/jest/testEnvironment',
  verbose: true,
  transform: {
    // isolatedModules (dans tsconfig — l'option transformer de même nom est
    // dépréciée depuis ts-jest 29.2) : transpile sans vérification de types.
    // Indispensable ici car les globaux Detox (expect/element/by) et ceux de Jest
    // se chevauchent (le `expect` de Jest masque celui de Detox au niveau des
    // types). Le contrôle de types n'a pas d'intérêt pour des tests E2E — seul le
    // transpile compte ; les vrais matchers Detox (toBeVisible…) marchent au runtime.
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: { isolatedModules: true, allowJs: true } }],
  },
};

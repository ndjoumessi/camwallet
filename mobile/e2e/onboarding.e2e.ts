// Tests E2E Detox — inscription complète (< 2 min).
// Pré-requis : simulateur iOS configuré, npm install --save-dev detox jest-circus
// Lancer : npx detox build -c ios.sim.debug && npx detox test -c ios.sim.debug

describe('Onboarding', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  afterAll(async () => {
    await device.terminateApp();
  });

  it('affiche l\'écran d\'accueil avec le bouton Commencer', async () => {
    await expect(element(by.id('onboarding-start-btn'))).toBeVisible();
  });

  it('navigue vers la saisie du numéro de téléphone', async () => {
    await element(by.id('onboarding-start-btn')).tap();
    await expect(element(by.id('phone-input'))).toBeVisible();
  });

  it('saisit un numéro valide et demande un OTP', async () => {
    await element(by.id('phone-input')).typeText('699000099');
    await element(by.id('phone-submit-btn')).tap();
    await expect(element(by.id('otp-input'))).toBeVisible();
  });

  it('valide l\'OTP et passe à la création du PIN', async () => {
    // En mode test, utiliser le code de test ou un code injecté via l'API de test
    await element(by.id('otp-input')).typeText('123456');
    await element(by.id('otp-submit-btn')).tap();
    await expect(element(by.id('pin-input'))).toBeVisible();
  });

  it('définit un PIN et accède au tableau de bord (< 2 min)', async () => {
    await element(by.id('pin-input')).typeText('654321');
    await element(by.id('pin-confirm-input')).typeText('654321');
    await element(by.id('pin-submit-btn')).tap();
    await expect(element(by.id('home-screen'))).toBeVisible();
  });
});

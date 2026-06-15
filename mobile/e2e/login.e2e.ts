// Tests E2E Detox — login PIN correct, PIN incorrect x3 → blocage.

describe('Login', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  afterAll(async () => {
    await device.terminateApp();
  });

  it('affiche l\'écran de connexion', async () => {
    await expect(element(by.id('login-phone-input'))).toBeVisible();
  });

  it('se connecte avec un PIN correct', async () => {
    await element(by.id('login-phone-input')).clearText();
    await element(by.id('login-phone-input')).typeText('+237677000001');
    await element(by.id('login-pin-input')).typeText('123456');
    await element(by.id('login-submit-btn')).tap();
    await expect(element(by.id('home-screen'))).toBeVisible();
  });

  it('affiche une erreur sur PIN incorrect', async () => {
    await device.launchApp({ newInstance: true });
    await element(by.id('login-phone-input')).typeText('+237677000001');
    await element(by.id('login-pin-input')).typeText('000000');
    await element(by.id('login-submit-btn')).tap();
    await expect(element(by.text('PIN incorrect'))).toBeVisible();
  });

  it('bloque le compte après 3 tentatives incorrectes', async () => {
    // 2ème tentative (1ère déjà faite dans le test précédent)
    await element(by.id('login-pin-input')).clearText();
    await element(by.id('login-pin-input')).typeText('000000');
    await element(by.id('login-submit-btn')).tap();

    // 3ème tentative
    await element(by.id('login-pin-input')).clearText();
    await element(by.id('login-pin-input')).typeText('000000');
    await element(by.id('login-submit-btn')).tap();

    await expect(element(by.text(/bloqué/i))).toBeVisible();
  });
});

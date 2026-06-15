// Tests E2E Detox — envoi P2P complet avec confirmation.

describe('Envoi P2P', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    // Login préalable
    await element(by.id('login-phone-input')).typeText('+237677000001');
    await element(by.id('login-pin-input')).typeText('123456');
    await element(by.id('login-submit-btn')).tap();
    await expect(element(by.id('home-screen'))).toBeVisible();
  });

  afterAll(async () => {
    await device.terminateApp();
  });

  it('ouvre le modal d\'envoi', async () => {
    await element(by.id('send-btn')).tap();
    await expect(element(by.id('send-modal'))).toBeVisible();
  });

  it('saisit le numéro du destinataire', async () => {
    await element(by.id('send-phone-input')).typeText('+237699000002');
    await element(by.id('send-next-btn')).tap();
    await expect(element(by.id('send-amount-input'))).toBeVisible();
  });

  it('saisit un montant et confirme', async () => {
    await element(by.id('send-amount-input')).typeText('5000');
    await element(by.id('send-confirm-btn')).tap();
    await expect(element(by.id('send-pin-modal'))).toBeVisible();
  });

  it('saisit le PIN et valide le virement', async () => {
    await element(by.id('confirm-pin-input')).typeText('123456');
    await element(by.id('confirm-pin-submit')).tap();
    await expect(element(by.id('send-success'))).toBeVisible();
  });
});

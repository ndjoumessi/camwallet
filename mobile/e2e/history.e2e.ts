// Tests E2E Detox — filtres historique, recherche, détail transaction.

describe('Historique des transactions', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await element(by.id('login-phone-input')).typeText('+237677000001');
    await element(by.id('login-pin-input')).typeText('123456');
    await element(by.id('login-submit-btn')).tap();
    await expect(element(by.id('home-screen'))).toBeVisible();
    await element(by.id('tab-history')).tap();
  });

  afterAll(async () => {
    await device.terminateApp();
  });

  it('affiche la liste des transactions', async () => {
    await expect(element(by.id('history-screen'))).toBeVisible();
  });

  it('filtre par Envois', async () => {
    await element(by.text('Envois')).tap();
    // Seules les transactions de type envoi doivent être visibles
    await expect(element(by.id('filter-chip-active'))).toBeVisible();
  });

  it('filtre par Reçus', async () => {
    await element(by.text('Reçus')).tap();
    await expect(element(by.id('filter-chip-active'))).toBeVisible();
  });

  it('effectue une recherche par nom', async () => {
    await element(by.id('history-search-input')).typeText('Marchand');
    await waitFor(element(by.id('tx-list'))).toBeVisible().withTimeout(3000);
  });

  it('efface la recherche', async () => {
    await element(by.id('history-search-clear')).tap();
    await expect(element(by.id('history-search-input'))).toHaveText('');
  });

  it('ouvre le détail d\'une transaction', async () => {
    await element(by.id('tx-item-0')).tap();
    await expect(element(by.id('tx-detail-modal'))).toBeVisible();
  });
});

import { resolveLang, translateMessage } from './i18n.util';

describe('i18n.util', () => {
  describe('resolveLang', () => {
    it('renvoie fr par défaut quand le header est absent', () => {
      expect(resolveLang(undefined)).toBe('fr');
      expect(resolveLang('')).toBe('fr');
    });

    it('détecte en depuis un header simple', () => {
      expect(resolveLang('en')).toBe('en');
      expect(resolveLang('en-US')).toBe('en');
    });

    it('respecte les q-values', () => {
      expect(resolveLang('en-US,en;q=0.9,fr;q=0.8')).toBe('en');
      expect(resolveLang('fr-FR,fr;q=0.9,en;q=0.5')).toBe('fr');
    });

    it('ignore les langues non supportées', () => {
      expect(resolveLang('de-DE,de;q=0.9')).toBe('fr');
      expect(resolveLang('es,en;q=0.4')).toBe('en');
    });
  });

  describe('translateMessage', () => {
    it('renvoie le message tel quel en fr', () => {
      expect(translateMessage('Solde insuffisant', 'fr')).toBe('Solde insuffisant');
    });

    it('traduit un message connu en en', () => {
      expect(translateMessage('Solde insuffisant', 'en')).toBe('Insufficient balance');
      expect(translateMessage('PIN incorrect', 'en')).toBe('Incorrect PIN');
    });

    it('traduit les messages interpolés par préfixe', () => {
      expect(translateMessage('Rôle invalide : ANALYST', 'en')).toBe('Invalid role: ANALYST');
      expect(
        translateMessage('Initiation du paiement CamPay échouée : timeout', 'en'),
      ).toBe('CamPay payment initiation failed: timeout');
    });

    it('conserve le français si aucune traduction connue', () => {
      expect(translateMessage('Message totalement inconnu', 'en')).toBe('Message totalement inconnu');
    });
  });
});

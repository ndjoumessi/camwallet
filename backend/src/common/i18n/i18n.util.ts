import { ERROR_MESSAGES_EN } from './error-messages';

export type SupportedLang = 'fr' | 'en';

const SUPPORTED: SupportedLang[] = ['fr', 'en'];
const DEFAULT_LANG: SupportedLang = 'fr';

// Préfixes interpolés (clé du dictionnaire se terminant par « : »).
const PREFIX_KEYS = Object.keys(ERROR_MESSAGES_EN).filter((k) => k.endsWith(': '));

/**
 * Résout la langue à partir d'un header `Accept-Language`.
 * Ex. « en-US,en;q=0.9,fr;q=0.8 » → 'en'. Défaut : français.
 */
export function resolveLang(acceptLanguage?: string): SupportedLang {
  if (!acceptLanguage) return DEFAULT_LANG;

  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const q = qParam ? parseFloat(qParam.split('=')[1]) : 1;
      return { lang: tag.trim().toLowerCase().split('-')[0], q: isNaN(q) ? 0 : q };
    })
    .filter((e) => SUPPORTED.includes(e.lang as SupportedLang))
    .sort((a, b) => b.q - a.q);

  return (ranked[0]?.lang as SupportedLang) ?? DEFAULT_LANG;
}

/**
 * Traduit un message d'erreur (français → langue cible).
 * Renvoie le message d'origine si aucune traduction n'est connue.
 */
export function translateMessage(message: string, lang: SupportedLang): string {
  if (lang === 'fr' || typeof message !== 'string') return message;

  // 1) Correspondance exacte
  const exact = ERROR_MESSAGES_EN[message];
  if (exact) return exact;

  // 2) Correspondance par préfixe (messages interpolés)
  for (const key of PREFIX_KEYS) {
    if (message.startsWith(key)) {
      return ERROR_MESSAGES_EN[key] + message.slice(key.length);
    }
  }

  // 3) Aucune traduction connue → on garde le français
  return message;
}

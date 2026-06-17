/**
 * Normalisation des numéros de téléphone camerounais au format E.164.
 *
 * AfricasTalking exige un numéro international (`+237XXXXXXXXX`) pour livrer un
 * SMS. On accepte les variantes de saisie courantes (espaces, séparateurs,
 * préfixes `+237` / `00237` / `237` / numéro national à 9 chiffres) et on
 * renvoie la forme canonique — ou `null` si ce n'est pas un numéro CM valide.
 *
 * Numéro national camerounais : 9 chiffres (mobiles en 6…, fixes en 2…).
 */
export function normalizeCameroonPhone(raw: string): string | null {
  if (typeof raw !== 'string') return null;

  // Retirer espaces et séparateurs usuels.
  let s = raw.trim().replace(/[\s().\-]/g, '');

  // Ramener les préfixes internationaux à la forme nationale (9 chiffres).
  if (s.startsWith('+237')) s = s.slice(4);
  else if (s.startsWith('00237')) s = s.slice(5);
  else if (s.startsWith('237')) s = s.slice(3);

  // Le numéro national doit être exactement 9 chiffres commençant par 2 ou 6.
  if (!/^[26]\d{8}$/.test(s)) return null;

  return `+237${s}`;
}

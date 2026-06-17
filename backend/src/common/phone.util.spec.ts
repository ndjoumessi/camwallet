import { normalizeCameroonPhone } from './phone.util';

describe('normalizeCameroonPhone', () => {
  it('garde un numéro déjà en E.164', () => {
    expect(normalizeCameroonPhone('+237677000001')).toBe('+237677000001');
  });

  it('accepte les variantes de préfixe', () => {
    expect(normalizeCameroonPhone('00237677000001')).toBe('+237677000001');
    expect(normalizeCameroonPhone('237677000001')).toBe('+237677000001');
    expect(normalizeCameroonPhone('677000001')).toBe('+237677000001');
  });

  it('nettoie espaces et séparateurs', () => {
    expect(normalizeCameroonPhone('+237 677 00 00 01')).toBe('+237677000001');
    expect(normalizeCameroonPhone(' 677-00-00-01 ')).toBe('+237677000001');
    expect(normalizeCameroonPhone('(237) 699.000.002')).toBe('+237699000002');
  });

  it('rejette les numéros invalides', () => {
    expect(normalizeCameroonPhone('')).toBeNull();
    expect(normalizeCameroonPhone('0677000001')).toBeNull(); // 0 initial → 10 chiffres
    expect(normalizeCameroonPhone('+23767700000')).toBeNull(); // trop court
    expect(normalizeCameroonPhone('+2376770000012')).toBeNull(); // trop long
    expect(normalizeCameroonPhone('+237177000001')).toBeNull(); // préfixe national 1 invalide
    expect(normalizeCameroonPhone('+33677000001')).toBeNull(); // autre pays
    expect(normalizeCameroonPhone('abcdefghi')).toBeNull();
  });

  it('rejette les entrées non-string', () => {
    expect(normalizeCameroonPhone(undefined as any)).toBeNull();
    expect(normalizeCameroonPhone(null as any)).toBeNull();
  });
});

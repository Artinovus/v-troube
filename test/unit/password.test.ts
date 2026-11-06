import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, DUMMY_HASH, hashToken, newSessionToken, passwordProblem } from '@/lib/password';

describe('hesla a relace', () => {
  it('hash a ověření hesla', async () => {
    const h = await hashPassword('Správné heslo 123');
    expect(h.startsWith('scrypt$65536$8$1$')).toBe(true);
    expect(h).not.toContain('Správné');
    expect(await verifyPassword('Správné heslo 123', h)).toBe(true);
    expect(await verifyPassword('spravne heslo 123', h)).toBe(false);
    expect(await hashPassword('Správné heslo 123')).not.toBe(h); // náhodná sůl
  });
  it('neplatný nebo zástupný hash nikdy neprojde', async () => {
    expect(await verifyPassword('cokoliv', DUMMY_HASH)).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$nesmysl')).toBe(false);
  });
  it('token relace a jeho otisk', () => {
    const t = newSessionToken();
    expect(t.length).toBeGreaterThanOrEqual(43);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(newSessionToken()).not.toBe(t);
  });
  it('pravidla hesla', () => {
    expect(passwordProblem('kratke')).toMatch(/12 znaků/);
    expect(passwordProblem('dostatečně dlouhé')).toBeNull();
  });
});

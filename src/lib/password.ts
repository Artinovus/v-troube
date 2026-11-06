/**
 * Hashování hesel přes scrypt (node:crypto, bez externích závislostí).
 * Formát: scrypt$N$r$p$<salt base64url>$<hash base64url>
 * Tento modul nesmí importovat nic serverově specifického – používají ho i skripty a testy.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash, type ScryptOptions } from 'node:crypto';

const N = 1 << 16; // 64 MiB paměti na výpočet
const R = 8;
const P = 1;
const KEYLEN = 32;

function scrypt(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFKC'), salt, KEYLEN, { ...opts, maxmem: 256 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64url');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64url'), { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Hash pro neexistující účet – ověření trvá stejně dlouho a neprozradí, zda e‑mail existuje. */
export const DUMMY_HASH = 'scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const PASSWORD_MIN_LENGTH = 12;

export function passwordProblem(pw: string): string | null {
  if (pw.length < PASSWORD_MIN_LENGTH) return `Heslo musí mít alespoň ${PASSWORD_MIN_LENGTH} znaků.`;
  if (pw.length > 200) return 'Heslo je příliš dlouhé.';
  return null;
}

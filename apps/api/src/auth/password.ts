import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// scrypt from node:crypto: no native addon to build in the Alpine image.
const N = 2 ** 16;
const r = 8;
const p = 1;
const KEY_LEN = 32;
const MAX_MEM = 128 * N * r * 2;

const derive = (password: string, salt: Buffer, keyLen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, keyLen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, KEY_LEN, { N, r, p, maxmem: MAX_MEM });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, rr, pp, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt' || !n || !rr || !pp || !saltB64 || !keyB64) return false;
  const salt = Buffer.from(saltB64, 'base64url');
  const expected = Buffer.from(keyB64, 'base64url');
  const key = await derive(password, salt, expected.length, { N: Number(n), r: Number(rr), p: Number(pp), maxmem: MAX_MEM });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

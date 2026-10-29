process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCb);

const SCRYPT_COST = { N: 1024, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

const b64url = value => Buffer.from(value).toString('base64url');
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, SCRYPT_COST);
  return `scrypt$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}$1024`;
}
export async function verifyPassword(password, encoded) {
  const [scheme, saltText, hashText, nText] = String(encoded).split('$');
  if (scheme !== 'scrypt' || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, 'base64url');
  const salt = Buffer.from(saltText, 'base64url');
  const cost = nText ? { N: parseInt(nText, 10), r: 8, p: 1, maxmem: 32 * 1024 * 1024 } : SCRYPT_COST;
  let actual = Buffer.from(await scrypt(password, salt, expected.length, cost));
  if (expected.length === actual.length && timingSafeEqual(expected, actual)) return true;
  if (!nText) {
    actual = Buffer.from(await scrypt(password, salt, expected.length));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  return false;
}
export function createToken(user, secret, ttlSeconds = 86400 * 30) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: user.id, email: user.email, iat: now, exp: now + ttlSeconds }));
  const unsigned = `${header}.${payload}`;
  const sig = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${sig}`;
}
export function verifyToken(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw Object.assign(new Error('Invalid bearer token'), { status: 401 });
  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = createHmac('sha256', secret).update(unsigned).digest();
  const actual = Buffer.from(parts[2], 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw Object.assign(new Error('Invalid bearer token'), { status: 401 });
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid bearer token'), { status: 401 });
  }
  if (typeof payload?.sub !== 'string' || typeof payload.exp !== 'number') {
    throw Object.assign(new Error('Invalid bearer token'), { status: 401 });
  }
  if (payload.exp <= Date.now() / 1000) throw Object.assign(new Error('Expired bearer token'), { status: 401 });
  return payload;
}

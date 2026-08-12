// Shared helpers for the Vercel serverless functions: Upstash Redis access +
// password hashing + signed session tokens. Secrets come from Vercel env vars.
import crypto from 'node:crypto';

const REDIS_URL   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const SECRET      = process.env.AUTH_SECRET || '';

// Run one Redis command via the Upstash REST API, e.g. redis(['GET', 'user:x']).
export async function redis(cmd) {
  if (!REDIS_URL || !REDIS_TOKEN) throw new Error('storage-not-configured');
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error('storage-error-' + r.status);
  const j = await r.json();
  return j.result;
}

export function hashPw(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

const DAY = 1000 * 60 * 60 * 24;
export function makeToken(id) {
  const body = id + '.' + (Date.now() + 180 * DAY);
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  return body + '.' + sig;
}
export function verifyToken(token) {
  if (!token || !SECRET) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  const good = crypto.createHmac('sha256', SECRET).update(id + '.' + exp).digest('hex');
  if (sig.length !== good.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  if (Date.now() > Number(exp)) return null;
  return id;
}
export function bearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}
export function timingEqual(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

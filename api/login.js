import { redis, hashPw, makeToken, timingEqual } from '../lib/store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { email, password } = req.body || {};
    const em = String(email || '').trim().toLowerCase();
    const raw = await redis(['GET', 'user:' + em]);
    const fail = () => res.status(401).json({ error: 'No account with that email, or wrong password.' });
    if (!raw) return fail();
    const u = JSON.parse(raw);
    if (!timingEqual(hashPw(password || '', u.salt), u.hash)) return fail();
    return res.status(200).json({ token: makeToken(u.id), email: em });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}

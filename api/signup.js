import crypto from 'node:crypto';
import { redis, hashPw, makeToken } from '../lib/store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { email, password } = req.body || {};
    const em = String(email || '').trim().toLowerCase();
    if (!em || !em.includes('@') || !password || String(password).length < 6) {
      return res.status(400).json({ error: 'Enter a valid email and a password of at least 6 characters.' });
    }
    const key = 'user:' + em;
    if (await redis(['GET', key])) {
      return res.status(409).json({ error: 'An account with that email already exists — sign in instead.' });
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPw(password, salt);
    const id = crypto.randomUUID();
    await redis(['SET', key, JSON.stringify({ id, salt, hash })]);
    return res.status(200).json({ token: makeToken(id), email: em });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}

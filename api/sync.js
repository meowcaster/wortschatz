import { redis, verifyToken, bearer } from '../lib/store.js';

// GET  -> returns the signed-in user's saved progress blob ({data: ... | null})
// POST -> stores {data: ...} as the user's progress blob
export default async function handler(req, res) {
  const id = verifyToken(bearer(req));
  if (!id) return res.status(401).json({ error: 'Not signed in.' });
  try {
    if (req.method === 'GET') {
      const raw = await redis(['GET', 'save:' + id]);
      return res.status(200).json({ data: raw ? JSON.parse(raw) : null });
    }
    if (req.method === 'POST') {
      const data = req.body && req.body.data;
      if (data == null) return res.status(400).json({ error: 'No data.' });
      await redis(['SET', 'save:' + id, JSON.stringify(data)]);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error.' });
  }
}

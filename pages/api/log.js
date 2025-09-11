// pages/api/log.js
import { put } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return res.status(500).json({ error: 'Missing BLOB_READ_WRITE_TOKEN' });

    const entry = req.body || {};
    // Basic validation
    if (!entry.ts) entry.ts = new Date().toISOString();

    // Create a unique path per entry (no append needed)
    const day = entry.ts.slice(0, 10); // YYYY-MM-DD
    const sid = entry.session_id || 'anon';
    const key = `rb-logs/${day}/${sid}/${Date.now()}-${Math.random().toString(36).slice(2)}.json`;

    const { url } = await put(
      key,
      JSON.stringify(entry, null, 2),
      { access: 'private', token, contentType: 'application/json' }
    );

    return res.status(200).json({ ok: true, url, key });
  } catch (err) {
    return res.status(500).json({ error: 'log write failed', details: String(err) });
  }
}

// pages/api/admin/logs.js
import { list } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const url = new URL(req.url, 'http://localhost'); // base won't be used
    const session = url.searchParams.get('session') || '';
    const limit = Math.min(Number(url.searchParams.get('limit') || 200), 1000);

    const prefix = session ? `logs/${session}/` : 'logs/';
    const { blobs } = await list({
      prefix,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      limit
    });

    // newest first
    blobs.sort((a, b) => (a.pathname < b.pathname ? 1 : -1));

    // fetch each blob's JSON (MVP; fine for a few hundred entries)
    const events = [];
    for (const b of blobs) {
      const r = await fetch(b.url);
      const j = await r.json().catch(() => null);
      if (j) events.push(j);
    }

    res.status(200).json({ count: events.length, events });
  } catch (e) {
    res.status(500).json({ error: 'admin list failed', details: String(e) });
  }
}

// pages/api/log.js
import { put } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const event = req.body || {};
    const session = event.session_id || 'anon';
    const ts = event.ts || new Date().toISOString();

    // each event = one blob; simple & race-free for MVP
    const key = `logs/${session}/${ts}-${Math.random().toString(36).slice(2)}.json`;

    await put(key, JSON.stringify(event), {
      access: 'public', // TODO: switch to 'private' + signed access later
      token: process.env.BLOB_READ_WRITE_TOKEN,
      contentType: 'application/json'
    });

    res.status(200).json({ ok: true, key });
  } catch (e) {
    res.status(500).json({ error: 'log write failed', details: String(e) });
  }
}

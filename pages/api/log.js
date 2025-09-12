// pages/api/log.js
import { sql } from '../../lib/db';

export default async function handler(req, res) {
  // Make the route tolerant of non-POST method checks to avoid noisy 405s
  if (req.method === 'HEAD' || req.method === 'OPTIONS' || req.method === 'GET') {
    res.setHeader('Allow', 'GET,HEAD,OPTIONS,POST');
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET,HEAD,OPTIONS,POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Create a minimal logs table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS logs (
        id          BIGSERIAL PRIMARY KEY,
        ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        session_id  TEXT,
        user_tag    TEXT,
        type        TEXT,
        payload     JSONB
      );
    `;

    const entry = req.body || {};
    const ts = entry.ts || new Date().toISOString();
    const { session_id = null, user_tag = null, type = null, ...rest } = entry;
    const payload = JSON.stringify(rest ?? {});

    const rows = await sql`
      INSERT INTO logs (ts, session_id, user_tag, type, payload)
      VALUES (${ts}, ${session_id}, ${user_tag}, ${type}, ${payload}::jsonb)
      RETURNING id, ts, session_id, user_tag, type;
    `;

    return res.status(200).json({ ok: true, inserted: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'log write failed', details: String(err) });
  }
}

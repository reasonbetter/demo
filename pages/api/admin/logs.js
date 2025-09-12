// pages/api/admin/logs.js
import { sql } from '../../../lib/db';

export default async function handler(req, res) {
  try {
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

    const { session_id, from, to, limit } = req.query || {};
    const lim = Math.max(1, Math.min(1000, Number(limit) || 200));

    let rows;
    if (session_id) {
      // Optional: filter by time range too
      if (from && to) {
        rows = await sql`
          SELECT id, ts, session_id, user_tag, type, payload
          FROM logs
          WHERE session_id = ${session_id}
            AND ts BETWEEN ${from}::timestamptz AND ${to}::timestamptz
          ORDER BY id DESC
          LIMIT ${lim};
        `;
      } else {
        rows = await sql`
          SELECT id, ts, session_id, user_tag, type, payload
          FROM logs
          WHERE session_id = ${session_id}
          ORDER BY id DESC
          LIMIT ${lim};
        `;
      }
    } else {
      // latest logs across all sessions
      rows = await sql`
        SELECT id, ts, session_id, user_tag, type, payload
        FROM logs
        ORDER BY id DESC
        LIMIT ${lim};
      `;
    }

    return res.status(200).json({ ok: true, logs: rows });
  } catch (err) {
    return res.status(500).json({ error: 'admin logs read failed', details: String(err) });
  }
}

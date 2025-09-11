export const config = { runtime: 'nodejs' };
import { sql } from "../../../lib/db.js";

export default async function handler(req, res) {
  try {
    const { rows } = await sql`
      SELECT id, started_at, finished_at, user_tag, theta_mean, theta_var, array_length(asked,1) AS item_count
      FROM sessions
      ORDER BY started_at DESC
      LIMIT 200`;
    res.status(200).json({ sessions: rows });
  } catch (e) {
    res.status(500).json({ error: 'list sessions failed', details: String(e) });
  }
}

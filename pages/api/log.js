let LOGS = []; // ephemeral on serverless; fine for demo

export default async function handler(req, res) {
  try {
    if (req.method === "POST") {
      const entry = req.body || {};
      const withTs = { ...entry, ts: entry.ts || new Date().toISOString() };
      LOGS.push(withTs);
      if (LOGS.length > 1000) LOGS = LOGS.slice(-1000);
      return res.status(200).json({ ok: true });
    }
    if (req.method === "GET") {
      return res.status(200).json({ logs: LOGS });
    }
    if (req.method === "DELETE") {
      LOGS = [];
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: "log error", details: String(e) });
  }
}

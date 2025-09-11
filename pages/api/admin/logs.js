// pages/api/admin/logs.js
export const config = { runtime: 'nodejs' }; // ensure Node runtime

export default async function handler(req, res) {
  try {
    const { list } = await import('@vercel/blob');

    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return res.status(500).json({ error: 'Missing BLOB_READ_WRITE_TOKEN' });

    // list today’s logs; tweak prefix to browse other days
    const today = new Date().toISOString().slice(0, 10);
    const prefix = `rb-logs/${today}/`;
    const { blobs } = await list({ prefix, token, limit: 100 });

    // You can also fetch and parse individual blob JSONs here if you want
    return res.status(200).json({ items: blobs.map(b => ({ key: b.pathname, size: b.size, url: b.url })) });
  } catch (err) {
    return res.status(500).json({ error: 'log list failed', details: String(err) });
  }
}

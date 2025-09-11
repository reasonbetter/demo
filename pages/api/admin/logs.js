// pages/api/admin/logs.js
import { list } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return res.status(500).json({ error: 'Missing BLOB_READ_WRITE_TOKEN' });

    const prefix = (req.query.prefix && String(req.query.prefix)) || 'rb-logs/';
    // list returns paginated results; for demo we pull first page
    const { blobs } = await list({ token, prefix, limit: 500 });

    return res.status(200).json({
      ok: true,
      count: blobs.length,
      items: blobs.map(b => ({
        key: b.pathname || b.key || b.name, // depending on SDK version
        size: b.size,
        uploadedAt: b.uploadedAt || b.createdAt,
        downloadUrl: b.downloadUrl || b.url
      }))
    });
  } catch (err) {
    return res.status(500).json({ error: 'list failed', details: String(err) });
  }
}

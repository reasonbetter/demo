// pages/admin/index.js
import { useEffect, useState } from 'react';

export default function Admin() {
  const [items, setItems] = useState([]);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await fetch('/api/admin/logs');
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'list failed');
        setItems(j.items || []);
      } catch (e) {
        setErr(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function loadJson(url) {
    try {
      setSelected(url);
      setPayload('loading…');
      const r = await fetch(url);
      const txt = await r.text();
      // Blob may set Content-Type text/plain; try to parse
      try { setPayload(JSON.parse(txt)); }
      catch { setPayload(txt); }
    } catch (e) {
      setPayload({ error: String(e) });
    }
  }

  return (
    <main style={{ maxWidth: 1000, margin: '40px auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Admin — Event Logs</h1>

      {loading && <p>Loading…</p>}
      {err && <p style={{ color: 'crimson' }}>{err}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <section style={{ border: '1px solid #eee', borderRadius: 8, padding: 12 }}>
          <h3>Entries ({items.length})</h3>
          <div style={{ maxHeight: 480, overflow: 'auto', fontSize: 14 }}>
            {items.map(it => (
              <div key={it.key} style={{ borderTop: '1px solid #f1f1f1', padding: '8px 0' }}>
                <div><strong>{it.key}</strong></div>
                <div style={{ color: '#666' }}>{new Date(it.uploadedAt || Date.now()).toLocaleString()}</div>
                <button onClick={() => loadJson(it.downloadUrl)} style={{ marginTop: 6 }}>
                  View JSON
                </button>
              </div>
            ))}
          </div>
        </section>

        <section style={{ border: '1px solid #eee', borderRadius: 8, padding: 12 }}>
          <h3>Selected</h3>
          <div style={{ fontSize: 12, color: '#555' }}>{selected || '—'}</div>
          <pre style={{ background: '#fafafa', padding: 12, borderRadius: 6, maxHeight: 480, overflow: 'auto' }}>
            {typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)}
          </pre>
        </section>
      </div>
    </main>
  );
}

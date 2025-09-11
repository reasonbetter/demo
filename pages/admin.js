import { useEffect, useState } from "react";

export default function Admin() {
  const [session, setSession] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const qs = session ? `?session=${encodeURIComponent(session)}` : "";
    const r = await fetch(`/api/admin/logs${qs}`);
    const data = await r.json().catch(() => ({ events: [] }));
    setRows(data.events || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []); // load on mount

  return (
    <main style={{ maxWidth: 960, margin: "40px auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>Admin — Session Log</h1>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <input
          placeholder="Filter by session id (prefix ok)"
          value={session}
          onChange={(e) => setSession(e.target.value)}
          style={{ padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, width: 360 }}
        />
        <button onClick={load} style={{ padding: "8px 12px" }} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
        <div style={{ marginLeft: "auto" }}>
          <strong>{rows.length}</strong> events
        </div>
      </div>

      {rows.map((ev, i) => (
        <AdminRow key={(ev.ts || i) + i} ev={ev} />
      ))}
    </main>
  );
}

function AdminRow({ ev }) {
  const [open, setOpen] = useState(false);
  const ts = ev.ts || "";
  const item = ev.item_id || "";
  const type = ev.type || "";
  return (
    <div style={{ borderTop: "1px solid #eee", paddingTop: 10, marginTop: 10 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ width: 210 }}><code>{ts}</code></div>
        <div style={{ width: 110 }}><span style={{ background:"#eef", padding:"2px 6px", borderRadius:4 }}>{type}</span></div>
        <div style={{ width: 140 }}>{item}</div>
        <div style={{ flex: 1, color: "#666" }}>{ev.text || ev.probe_prompt || ""}</div>
        <button onClick={() => setOpen(!open)} style={{ padding: "6px 10px" }}>
          {open ? "Hide" : "View"}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 8, display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <div><strong>User Answer</strong></div>
            <pre style={preStyle}>{ev.user_answer || ev.probe_answer || ""}</pre>
            {ev.aj && (<>
              <div><strong>AJ (item)</strong></div>
              <pre style={preStyle}>{JSON.stringify(ev.aj, null, 2)}</pre>
            </>)}
            {ev.twAj && (<>
              <div><strong>AJ (probe)</strong></div>
              <pre style={preStyle}>{JSON.stringify(ev.twAj, null, 2)}</pre>
            </>)}
          </div>
          <div>
            {ev.turn && (<>
              <div><strong>Controller (item)</strong></div>
              <pre style={preStyle}>{JSON.stringify(ev.turn, null, 2)}</pre>
            </>)}
            {ev.merged && (<>
              <div><strong>Controller (merge)</strong></div>
              <pre style={preStyle}>{JSON.stringify(ev.merged, null, 2)}</pre>
            </>)}
            {ev.trace && (<>
              <div><strong>Trace</strong></div>
              <pre style={preStyle}>{(ev.trace || []).join("\n")}</pre>
            </>)}
          </div>
        </div>
      )}
    </div>
  );
}

const preStyle = {
  background: "#fafafa",
  padding: 10,
  borderRadius: 6,
  maxHeight: 240,
  overflow: "auto",
  border: "1px solid #eee",
};

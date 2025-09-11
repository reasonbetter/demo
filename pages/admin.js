import { useEffect, useState } from "react";

export default function Admin() {
  const [serverLogs, setServerLogs] = useState([]);
  const [localLogs, setLocalLogs] = useState([]);

  async function refresh() {
    try {
      const res = await fetch("/api/log");
      const data = await res.json();
      setServerLogs(data.logs || []);
    } catch {
      setServerLogs([]);
    }
    try {
      const arr = JSON.parse(localStorage.getItem("rb_local_logs") || "[]");
      setLocalLogs(arr);
    } catch {
      setLocalLogs([]);
    }
  }

  function downloadLocalJSON() {
    const blob = new Blob([JSON.stringify(localLogs, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `rb-local-logs-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  async function clearServer() {
    await fetch("/api/log", { method: "DELETE" });
    refresh();
  }
  function clearLocal() {
    localStorage.removeItem("rb_local_logs");
    refresh();
  }

  useEffect(() => { refresh(); }, []);

  return (
    <div className="wrap">
      <h1 className="headline">Admin — Session Logs (Demo)</h1>
      <p className="muted">
        Server logs are <strong>ephemeral</strong> (in‑memory) on serverless. For the demo, also collecting to localStorage on each browser.
      </p>

      <div className="row" style={{ marginBottom: 12 }}>
        <a className="link" href="/">← Back to Demo</a>
        <button className="btn btn-secondary" onClick={refresh}>Refresh</button>
        <button className="btn btn-secondary" onClick={downloadLocalJSON}>Download Local JSON</button>
        <button className="btn btn-secondary" onClick={clearServer}>Clear Server</button>
        <button className="btn btn-secondary" onClick={clearLocal}>Clear Local</button>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <h3>Server Logs (latest {serverLogs.length})</h3>
        <div className="debug" style={{ maxHeight: 320 }}>
{JSON.stringify(serverLogs.slice(-500), null, 2)}
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h3>Local Logs (this browser)</h3>
        <div className="debug" style={{ maxHeight: 320 }}>
{JSON.stringify(localLogs.slice(-500), null, 2)}
        </div>
      </section>

      <style jsx>{``}</style>
    </div>
  );
}

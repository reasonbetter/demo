import { useEffect, useMemo, useState } from "react";
import bank from "../public/data/itemBank.json";

export default function Home() {
  const [sessionId, setSessionId] = useState(null);
  const [userTag, setUserTag] = useState("");
  const [currentId, setCurrentId] = useState(bank.items[0].item_id);
  const [input, setInput] = useState("");
  const [probeInput, setProbeInput] = useState("");
  const [log, setLog] = useState([]);
  const [history, setHistory] = useState([]);
  const [awaitingProbe, setAwaitingProbe] = useState(null);
  const [theta, setTheta] = useState({ mean: 0, se: Math.sqrt(1.5) });
  const [showDebug, setShowDebug] = useState(false);
  const [pending, setPending] = useState(false);

  const currentItem = useMemo(
    () => bank.items.find((it) => it.item_id === currentId),
    [currentId]
  );

  // --- helpers ----------------------------------------------------------------
  function probePromptFor(type) {
    if (type === "Mechanism")
      return "One sentence: briefly explain the mechanism that could make this result misleading.";
    if (type === "Alternative")
      return "In a few words: give one different explanation for the link (not the one you already mentioned).";
    if (type === "Boundary")
      return "One sentence: name a condition where your conclusion would fail.";
    if (type === "Completion")
      return "Can you give one more different reason?";
    if (type === "Clarify")
      return "In one sentence: clarify what you meant.";
    return "";
  }
  function probeTextFromServer(turnPayload) {
    const t = (turnPayload?.probe_text || "").trim();
    return t.length > 0 ? t : probePromptFor(turnPayload?.probe_type);
  }
  async function logEvent(type, payload) {
    const entry = {
      ts: new Date().toISOString(),
      session_id: sessionId,
      user_tag: userTag || null,
      type,
      ...payload
    };
    try { await fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry) }); } catch {}
    try {
      const key = "rb_local_logs";
      const arr = JSON.parse(localStorage.getItem(key) || "[]");
      arr.push(entry);
      localStorage.setItem(key, JSON.stringify(arr).slice(0, 1_000_000));
    } catch {}
  }

  // --- API calls --------------------------------------------------------------
  async function callAJ({ item, userResponse, twType = null }) {
    try {
      const res = await fetch("/api/aj", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item,
          userResponse,
          features: {
            schema_id: item.schema_id,
            item_id: item.item_id,
            family: item.family,
            coverage_tag: item.coverage_tag,
            band: item.band,
            item_params: { a: item.a, b: item.b },
            tw_type: twType
          }
        })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`AJ HTTP ${res.status}: ${text.slice(0, 800)}`);
      }
      return await res.json();
    } catch (e) {
      alert(`AJ error: ${e.message}`);
      return {
        labels: { Novel: 1.0 },
        pitfalls: {},
        process_moves: {},
        calibrations: { p_correct: 0.0, confidence: 0.2 },
        extractions: { direction_word: null, key_phrases: [] },
        probe: { intent: "None", text: "", rationale: "", confidence: 0.0 }
      };
    }
  }

async function callTurn({ itemId, ajMeasurement, twMeasurement = null }) {
  try {
    const res = await fetch("/api/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, ajMeasurement, twMeasurement })
    });
    if (!res.ok) {
      const text = await res.text(); // capture the real error
      throw new Error(text);
    }
    return await res.json();
  } catch (e) {
    alert(`Controller error: ${e.message}`);
    // ... your existing safe fallback ...
    return {
      final_label: "Novel",
      probe_type: "None",
      probe_text: "",
      next_item_id:
        bank.items.find((it) => it.item_id !== itemId)?.item_id || itemId,
      theta_mean: 0,
      theta_var: 1.5,
      coverage_counts: {},
      trace: [`Controller error: ${e.message}`]
    };
  }
}


  // --- submit handlers --------------------------------------------------------
  async function onSubmit(e) {
    e.preventDefault();
    if (!input.trim() || pending) return;
    setPending(true);

    const aj = await callAJ({ item: currentItem, userResponse: input });
    const turn = await callTurn({ itemId: currentItem.item_id, ajMeasurement: aj });

    setHistory((h) => [
      ...h,
      {
        item_id: currentItem.item_id,
        text: currentItem.text,
        answer: input,
        label: turn.final_label,
        probe_type: turn.probe_type,
        probe_text: (turn.probe_text || ""),
        trace: turn.trace
      }
    ]);
    setLog((lines) => [...lines, ...turn.trace, "—"]);
    setTheta({ mean: Number(turn.theta_mean.toFixed(2)), se: Number(Math.sqrt(turn.theta_var).toFixed(2)) });

    await logEvent("item_answered", {
      item_id: currentItem.item_id,
      label: turn.final_label,
      probe_type: turn.probe_type
    });

    const prompt = probeTextFromServer(turn);
    const hasProbe = !!(turn.probe_type && turn.probe_type !== "None" && prompt);
    if (hasProbe) {
      setAwaitingProbe({
        probeType: turn.probe_type,
        prompt,
        pending: { aj, next_item_id: turn.next_item_id }
      });
    } else {
      setCurrentId(turn.next_item_id || currentItem.item_id);
    }

    setInput("");
    setPending(false);
  }

  async function onSubmitProbe(e) {
    e.preventDefault();
    if (!awaitingProbe || !probeInput.trim() || pending) return;
    setPending(true);

    const tw = await callAJ({
      item: currentItem,
      userResponse: probeInput,
      twType: awaitingProbe.probeType
    });

    const merged = await callTurn({
      itemId: currentItem.item_id,
      ajMeasurement: awaitingProbe.pending.aj,
      twMeasurement: tw
    });

    setLog((lines) => [...lines, ...merged.trace, "—"]);
    setTheta({ mean: Number(merged.theta_mean.toFixed(2)), se: Number(Math.sqrt(merged.theta_var).toFixed(2)) });
    setCurrentId(merged.next_item_id || currentItem.item_id);

    setHistory((h) => {
      const last = h[h.length - 1];
      const updated = { ...last, probe_answer: probeInput, probe_label: awaitingProbe.probeType };
      return [...h.slice(0, -1), updated];
    });

    await logEvent("probe_answered", {
      item_id: currentItem.item_id,
      probe_type: awaitingProbe.probeType
    });

    setAwaitingProbe(null);
    setProbeInput("");
    setPending(false);
  }

  function endSession() {
    logEvent("session_end", { item_count: history.length });
    alert("Session ended. Visit /admin to view the log.");
  }

  // --- init -------------------------------------------------------------------
  useEffect(() => {
    const id = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
    setSessionId(id);
    logEvent("session_start", { item_id: currentId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- render -----------------------------------------------------------------
  return (
    <div className="wrap">
      <h1 className="headline">Reasoning Demo — Causal Structure (Pilot)</h1>

      <div className="subhead">
        <span className="badge"><strong>θ</strong>&nbsp;{theta.mean}</span>
        <span className="badge"><strong>SE</strong>&nbsp;{theta.se}</span>
        <span className="badge">Item: {currentItem.item_id}</span>
        <span className="badge">Tag: {currentItem.coverage_tag}</span>
        <span className="badge">Session: {sessionId?.slice(0, 8)}</span>
        <span className="badge">
          <label className="muted" style={{ marginRight: 6 }}>Your initials</label>
          <input className="input" style={{ width: 110, padding: "6px 8px" }} value={userTag} onChange={(e) => setUserTag(e.target.value)} placeholder="optional" />
        </span>
        <a className="link" href="/admin" title="Admin log" style={{ marginLeft: "auto" }}>Admin</a>
      </div>

      <div className="spacer" />

      <section className="card">
        <p className="question">{currentItem.text}</p>

        {!awaitingProbe && (
          <form onSubmit={onSubmit}>
            <textarea
              className="textarea"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Your answer (a few words or one sentence)"
              rows={2}
              autoFocus
            />
            <div className="row" style={{ marginTop: 10 }}>
              <button type="submit" className="btn" disabled={pending}>Submit</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowDebug((s) => !s)}>
                {showDebug ? "Hide debug" : "Show debug"}
              </button>
              <button type="button" className="btn btn-secondary" onClick={endSession}>
                End Session
              </button>
            </div>
          </form>
        )}

        {awaitingProbe && (
          <form onSubmit={onSubmitProbe}>
            <div className="probe" style={{ marginBottom: 8 }}>{awaitingProbe.prompt}</div>
            <input
              className="input"
              value={probeInput}
              onChange={(e) => setProbeInput(e.target.value)}
              placeholder="One sentence"
            />
            <div className="row" style={{ marginTop: 10 }}>
              <button type="submit" className="btn" disabled={pending}>Submit follow‑up</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowDebug((s) => !s)}>
                {showDebug ? "Hide debug" : "Show debug"}
              </button>
            </div>
          </form>
        )}
      </section>

      {showDebug && (
        <section style={{ marginTop: 24 }}>
          <h3>Session Trace (debug)</h3>
          <div className="debug">{log.join("\n")}</div>
        </section>
      )}

      <section style={{ marginTop: 24 }}>
        <h3>History</h3>
        {history.map((h) => (
          <div key={h.item_id} className="historyItem">
            <div><strong>{h.item_id}</strong> — {h.label} {h.probe_type !== "None" ? `(probe: ${h.probe_type})` : ""}</div>
            <div className="muted">{h.text}</div>
            <div><em>Ans:</em> {h.answer}</div>
            {h.probe_answer && <div><em>Probe:</em> {h.probe_answer}</div>}
          </div>
        ))}
      </section>
    </div>
  );
}

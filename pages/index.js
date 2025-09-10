import { useEffect, useMemo, useState } from "react";
import bank from "../public/data/itemBank.json";

export default function Home() {
  const [currentId, setCurrentId] = useState(bank.items[0].item_id);
  const [input, setInput] = useState("");
  const [probeInput, setProbeInput] = useState("");
  const [log, setLog] = useState([]);
  const [history, setHistory] = useState([]);
  const [awaitingProbe, setAwaitingProbe] = useState(null); // { probeType, prompt }
  const [theta, setTheta] = useState({ mean: 0, se: Math.sqrt(1.5) });

  const currentItem = useMemo(
    () => bank.items.find((it) => it.item_id === currentId),
    [currentId]
  );

  async function callAJ({ item, userResponse, twType = null }) {
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
          schema_features: bank.schema_features[item.schema_id] || {},
          tw_type: twType
        }
      })
    });
    return res.json();
  }

  async function callTurn({ itemId, ajMeasurement, twMeasurement = null }) {
    const res = await fetch("/api/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId,
        ajMeasurement,
        twMeasurement
      })
    });
    return res.json();
  }

  function probePromptFor(type) {
    if (type === "Mechanism")
      return "One sentence: briefly explain the mechanism that could make this result misleading.";
    if (type === "Alternative")
      return "In a few words: give one different explanation for the link (not the one you already mentioned).";
    if (type === "Boundary")
      return "One sentence: name a condition where your conclusion would fail.";
    return "";
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!input.trim()) return;

    // 1) AJ on item answer
    const aj = await callAJ({ item: currentItem, userResponse: input });

    // 2) Orchestrator on item
    const turn = await callTurn({ itemId: currentItem.item_id, ajMeasurement: aj });

    // Record
    setHistory((h) => [
      ...h,
      {
        item_id: currentItem.item_id,
        text: currentItem.text,
        answer: input,
        label: turn.final_label,
        probe_type: turn.probe_type,
        trace: turn.trace
      }
    ]);
    setLog((lines) => [...lines, ...turn.trace, "—"]);

    setTheta({ mean: Number(turn.theta_mean.toFixed(2)), se: Number(Math.sqrt(turn.theta_var).toFixed(2)) });

    // 3) If probe needed, set awaitingProbe; else move to next item
    if (turn.probe_type && turn.probe_type !== "None") {
      setAwaitingProbe({
        probeType: turn.probe_type,
        prompt: probePromptFor(turn.probe_type),
        pending: { aj, next_item_id: turn.next_item_id } // we will re-merge after TW
      });
    } else {
      setCurrentId(turn.next_item_id || currentItem.item_id);
    }

    setInput("");
  }

  async function onSubmitProbe(e) {
    e.preventDefault();
    if (!awaitingProbe || !probeInput.trim()) return;

    // 1) AJ on TW
    const tw = await callAJ({
      item: currentItem,
      userResponse: probeInput,
      twType: awaitingProbe.probeType
    });

    // 2) Merge & advance
    const merged = await callTurn({
      itemId: currentItem.item_id,
      ajMeasurement: awaitingProbe.pending.aj,
      twMeasurement: tw
    });

    setLog((lines) => [...lines, ...merged.trace, "—"]);
    setTheta({ mean: Number(merged.theta_mean.toFixed(2)), se: Number(Math.sqrt(merged.theta_var).toFixed(2)) });
    setCurrentId(merged.next_item_id || currentItem.item_id);

    // record probe
    setHistory((h) => {
      const last = h[h.length - 1];
      const updated = { ...last, probe_answer: probeInput, probe_label: awaitingProbe.probeType };
      return [...h.slice(0, -1), updated];
    });

    setAwaitingProbe(null);
    setProbeInput("");
  }

  useEffect(() => {
    // Start at first item id already set
  }, []);

  return (
    <main style={{ maxWidth: 800, margin: "40px auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>Reasoning Demo — Causal Structure (Pilot)</h1>

      <section style={{ padding: "16px", border: "1px solid #eee", borderRadius: 8, marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 24 }}>
          <div><strong>θ</strong>: {theta.mean}</div>
          <div><strong>SE</strong>: {theta.se}</div>
          <div><strong>Item</strong>: {currentItem.item_id}</div>
          <div><strong>Tag</strong>: {currentItem.coverage_tag}</div>
        </div>
      </section>

      <section style={{ padding: 16, border: "1px solid #ddd", borderRadius: 8, marginBottom: 16 }}>
        <p style={{ whiteSpace: "pre-wrap" }}>{currentItem.text}</p>

        {!awaitingProbe && (
          <form onSubmit={onSubmit} style={{ marginTop: 12 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Your answer (few words or one sentence)"
              style={{ width: "100%", padding: 12, borderRadius: 6, border: "1px solid #ccc" }}
            />
            <button type="submit" style={{ marginTop: 10, padding: "10px 14px" }}>
              Submit
            </button>
          </form>
        )}

        {awaitingProbe && (
          <form onSubmit={onSubmitProbe} style={{ marginTop: 12 }}>
            <div style={{ fontStyle: "italic", marginBottom: 8 }}>{awaitingProbe.prompt}</div>
            <input
              value={probeInput}
              onChange={(e) => setProbeInput(e.target.value)}
              placeholder="One sentence"
              style={{ width: "100%", padding: 12, borderRadius: 6, border: "1px solid #ccc" }}
            />
            <button type="submit" style={{ marginTop: 10, padding: "10px 14px" }}>
              Submit follow‑up
            </button>
          </form>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h3>Session Trace (debug)</h3>
        <pre style={{ background: "#fafafa", padding: 12, borderRadius: 6, maxHeight: 260, overflow: "auto" }}>
{log.join("\n")}
        </pre>
      </section>

      <section style={{ marginTop: 24 }}>
        <h3>History</h3>
        {history.map((h) => (
          <div key={h.item_id} style={{ borderTop: "1px solid #eee", paddingTop: 8, marginTop: 8 }}>
            <div><strong>{h.item_id}</strong> — {h.label} {h.probe_type !== "None" ? `(probe: ${h.probe_type})` : ""}</div>
            <div style={{ color: "#555" }}>{h.text}</div>
            <div><em>Ans:</em> {h.answer}</div>
            {h.probe_answer && <div><em>Probe:</em> {h.probe_answer}</div>}
          </div>
        ))}
      </section>
    </main>
  );
}

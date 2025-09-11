import { useEffect, useMemo, useState } from "react";
import bank from "../public/data/itemBank.json";

export default function Home() {
  const [currentId, setCurrentId] = useState(bank.items[0].item_id);
  const [input, setInput] = useState("");
  const [probeInput, setProbeInput] = useState("");
  const [log, setLog] = useState([]);
  const [history, setHistory] = useState([]);
  const [awaitingProbe, setAwaitingProbe] = useState(null); // { probeType, prompt, pending }
  const [theta, setTheta] = useState({ mean: 0, se: Math.sqrt(1.5) });

  const currentItem = useMemo(
    () => bank.items.find((it) => it.item_id === currentId),
    [currentId]
  );

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
            expect_direction_word: item.family.startsWith("C6"),
            expected_list_count: item.family.startsWith("C1") ? 2 : undefined,
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
      // Safe fallback so UI continues
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
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Turn HTTP ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      alert(`Controller error: ${e.message}`);
      // Minimal no-op result so UI stays responsive
      const nextSafe =
        bank.items.find((it) => it.item_id !== itemId)?.item_id || itemId;
      return {
        final_label: "Novel",
        probe_type: "None",
        probe_text: "",
        next_item_id: nextSafe,
        theta_mean: 0,
        theta_var: 1.5,
        coverage_counts: {},
        trace: [`Controller error: ${e.message}`]
      };
    }
  }

  // Canned fallbacks for probes (used only if server didn't supply text)
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

  // Prefer server-authored probe text; fall back to canned map
  function probeTextFromServer(turnPayload) {
    const t = (turnPayload?.probe_text || "").trim();
    if (t.length > 0) return t; // use AJ/orchestrator-authored sentence
    return probePromptFor(turnPayload?.probe_type);
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!input.trim()) return;

    // 1) AJ on item answer
    const aj = await callAJ({ item: currentItem, userResponse: input });

    // 2) Orchestrator on item
    const turn = await callTurn({
      itemId: currentItem.item_id,
      ajMeasurement: aj
    });

    // 3) Record
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
    setTheta({
      mean: Number(turn.theta_mean.toFixed(2)),
      se: Number(Math.sqrt(turn.theta_var).toFixed(2))
    });

    // 4) If probe needed, use server-authored text; else move to next item
    const prompt = probeTextFromServer(turn);
    const hasProbe = !!(turn.probe_type && turn.probe_type !== "None" && prompt);

    if (hasProbe) {
      setAwaitingProbe({
        probeType: turn.probe_type,
        prompt, // AJ/orchestrator-authored sentence
        pending: { aj, next_item_id: turn.next_item_id } // re-merge after TW
      });
    } else {
      setCurrentId(turn.next_item_id || currentItem.item_id);
    }

    setInput("");
  }

  async function onSubmitProbe(e) {
    e.preventDefault();
    if (!awaitingProbe || !probeInput.trim()) return;

    // 1) AJ on transcript window (probe answer)
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
    setTheta({
      mean: Number(merged.theta_mean.toFixed(2)),
      se: Number(Math.sqrt(merged.theta_var).toFixed(2))
    });
    setCurrentId(merged.next_item_id || currentItem.item_id);

    // record probe answer on last history row
    setHistory((h) => {
      const last = h[h.length - 1];
      const updated = {
        ...last,
        probe_answer: probeInput,
        probe_label: awaitingProbe.probeType
      };
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

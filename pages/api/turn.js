// Minimal orchestrator API: policy, theta update, next-item selection

import bank from "../../public/data/itemBank.json";

const CFG = {
  tau_complete: 0.70,
  tau_required_move: 0.60,
  tau_pitfall_hi: 0.30,
  tau_confidence: 0.75,
  enable_c6_patch: true,
  coverage_targets: ["confounding", "temporality", "complexity"],
  score_map: {
    "Correct&Complete": 1.0,
    "Correct_Missing": 0.85,
    "Correct_Flawed": 0.60,
    "Partial": 0.40,
    "Incorrect": 0.0,
    "Novel": 0.0
  }
};
const BANNED_TOKENS = [
  "confounder","mediator","collider","post-treatment","reverse causation",
  "selection bias","instrumental variable","simpson","berkson"
];

const PROBE_LIBRARY = {
  Completion: [
    "Good start—please add one more different reason (a few words).",
    "Thanks—give one more distinct reason (a few words)."
  ],
  Clarify: [
    "Please make that more concrete (a few words).",
    "Could you be more specific (a few words)?"
  ],
  Mechanism: [
    "In one sentence, briefly explain the path from cause to result.",
    "One sentence: how would this lead to that?"
  ],
  Alternative: [
    "Give one fundamentally different explanation (a few words).",
    "Name a second, different way the link could arise (few words)."
  ],
  Boundary: [
    "Name a condition under which your conclusion would no longer hold (few words)."
  ],
  None: [""]
};

function passesProbeGuard(item, probe) {
  if (!probe || probe.intent === "None") return false;
  const t = (probe.text || "").toLowerCase();

  // length & punctuation sanity
  if (t.length === 0 || t.length > 200) return false;
  if (!/[?.!]$/.test(t.trim())) return false;

  // jargon / cueing
  if (BANNED_TOKENS.some(tok => t.includes(tok))) return false;

  // (optional) avoid over-quoting the stem
  const stem = (item.text || "").toLowerCase();
  const overlap = t.split(/\s+/).filter(w => stem.includes(w)).length;
  if (overlap > 12) return false;

  return true;
}

function fallbackProbe(intent) {
  const arr = PROBE_LIBRARY[intent] || [];
  const text = arr[Math.floor(Math.random() * arr.length)] || "";
  return { intent, text, rationale: "library_fallback", confidence: 0.6, source: "library" };
}

// keep a simple session in memory per server instance (fine for demo)
let SESSION = {
  theta_mean: 0,
  theta_var: 1.5,
  asked: [],
  coverage: { confounding: 0, temporality: 0, complexity: 0 },
  usedGroups: {}
};

function sigmoid(x) {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1.0 / (1.0 + z);
  } else {
    const z = Math.exp(x);
    return z / (1.0 + z);
  }
}

function itemById(id) {
  return bank.items.find((it) => it.item_id === id);
}

function expectedScore(labels) {
  const m = CFG.score_map;
  return Object.entries(labels || {}).reduce((acc, [k, v]) => acc + (m[k] || 0) * v, 0);
}

function labelArgmax(labels) {
  let best = "Novel";
  let bestp = -1;
  for (const [k, v] of Object.entries(labels || {})) {
    if (v > bestp) { bestp = v; best = k; }
  }
  return [best, bestp];
}

function finalizeLabelAndProbe(item, aj, schemaFeatures) {
  const trace = [];
  const labels = aj.labels || { Novel: 1.0 };
  const [finalLabel, pFinal] = labelArgmax(labels);
  const conf = aj.calibrations?.confidence ?? 0.5;
  trace.push(`Argmax label=${finalLabel} (${pFinal.toFixed(2)}); AJ confidence=${conf.toFixed(2)}`);

  // pitfalls present
  const pit = aj.pitfalls || {};
  const highPit = Object.entries(pit).filter(([_, v]) => v >= CFG.tau_pitfall_hi).map(([k]) => k);
  if (highPit.length) trace.push(`High pitfalls: ${highPit.join(", ")}`);

  // required process moves
  const req = (schemaFeatures?.required_moves) || [];
  const pm = aj.process_moves || {};
  let moveOK = true;
  for (const mv of req) {
    if ((pm[mv] || 0) < CFG.tau_required_move) moveOK = false;
  }
  if (req.length) trace.push(`Required moves present? ${moveOK} (need ≥${CFG.tau_required_move})`);

  // Evidence sufficiency → no probe
  const pComplete = labels["Correct&Complete"] || 0;
  const anyHiPit = highPit.length > 0;
  if (pComplete >= CFG.tau_complete && moveOK && !anyHiPit && conf >= CFG.tau_confidence) {
    trace.push("Evidence sufficient → skip probe.");
    return { finalLabel, probe: { intent: "None", text: "", source: "policy" }, trace };
  }

  // Universal “AJ obviously failed” guard (e.g., Novel 0.99 with very low confidence)
  const isFallbackNovel = (labels["Novel"] || 0) >= 0.99 && conf <= 0.25;
  if (isFallbackNovel) {
    trace.push("AJ looked like a fallback/failed call → no probe this turn.");
    return { finalLabel, probe: { intent: "None", text: "", source: "policy" }, trace };
  }

  // 1) Prefer AJ-authored probe if present & safe
  const ajProbe = aj.probe || { intent: "None", text: "" };
  if (ajProbe.intent !== "None" && passesProbeGuard(item, ajProbe)) {
    trace.push(`Using AJ probe intent=${ajProbe.intent} (guard passed).`);
    return { finalLabel, probe: { ...ajProbe, source: "AJ" }, trace };
  }

  // 2) Otherwise, apply a tiny schema-aware default (only where essential)
  // C1: Confounder Generation expects two distinct reasons
  if (item.family?.startsWith("C1")) {
    const onlyOne = (pit["only_one_reason_given"] || 0) >= 0.5 || (labels["Partial"] || 0) >= 0.6;
    if (onlyOne) {
      const p = fallbackProbe("Completion");
      trace.push("C1: only one reason given → Completion probe (fallback).");
      return { finalLabel, probe: p, trace };
    }
  }

  // C8 (from your prior policy): Boundary is most diagnostic for low-quality
  if (item.family?.startsWith("C8") && ["Partial", "Incorrect", "Novel"].includes(finalLabel)) {
    const p = fallbackProbe("Boundary");
    trace.push("C8: low-quality → Boundary probe (fallback).");
    return { finalLabel, probe: p, trace };
  }

  // 3) Last resort: minimal label-aware fallback (no heavy mapping)
  let intent = "None";
  if (finalLabel === "Correct&Complete") intent = "None";
  else if (finalLabel === "Correct_Missing" || finalLabel === "Correct_Flawed") intent = "Mechanism";
  else if (["Partial", "Incorrect", "Novel"].includes(finalLabel)) intent = "Alternative";

  const p = fallbackProbe(intent);
  trace.push(`Fallback intent=${intent} (minimal policy).`);
  return { finalLabel, probe: p, trace };
}


function fusePCorrect(theta, item, aj) {
  const pBase = sigmoid(item.a * (theta - item.b));
  const pAj = aj.calibrations?.p_correct;
  if (pAj == null) return { p: pBase, note: `p_base=${pBase.toFixed(3)}; no p_correct_AJ` };
  const p = 0.5 * pBase + 0.5 * pAj;
  return { p, note: `p_base=${pBase.toFixed(3)}; p_correct_AJ=${pAj.toFixed(3)}; p_fused=${p.toFixed(3)}` };
}

function thetaUpdate(item, aj) {
  const labels = aj.labels || {};
  const yhat = expectedScore(labels);
  const { p, note } = fusePCorrect(SESSION.theta_mean, item, aj);
  const info = (item.a ** 2) * p * (1 - p) + 1e-6;
  const thetaVarNew = 1.0 / (1.0 / SESSION.theta_var + info);
  const thetaMeanNew = SESSION.theta_mean + thetaVarNew * item.a * (yhat - p);
  const t = [
    note,
    `y_hat=${yhat.toFixed(3)}; info=${info.toFixed(3)}; θ: ${SESSION.theta_mean.toFixed(2)}→${thetaMeanNew.toFixed(2)}; var: ${SESSION.theta_var.toFixed(2)}→${thetaVarNew.toFixed(2)}`
  ];
  SESSION.theta_mean = thetaMeanNew;
  SESSION.theta_var = thetaVarNew;
  return t;
}

function eligibleCandidates(currentItem) {
  const askedSet = new Set(SESSION.asked);
  return bank.items.filter((it) => !askedSet.has(it.item_id));
}

function applyCoverage(cands) {
  const need = CFG.coverage_targets.filter((tag) => (SESSION.coverage[tag] || 0) === 0);
  if (need.length === 0) return cands;
  const prior = cands.filter((it) => need.includes(it.coverage_tag));
  return prior.length ? prior : cands;
}

function eigProxy(theta, it) {
  const p = sigmoid(it.a * (theta - it.b));
  return (it.a ** 2) * p * (1 - p);
}

function selectNextItem(currentItem) {
  const trace = [];
  let cands = eligibleCandidates(currentItem);
  cands = applyCoverage(cands);
  const scored = cands.map((it) => [eigProxy(SESSION.theta_mean, it), it]);
  scored.sort((a, b) => b[0] - a[0]);
  if (scored.length === 0) {
    trace.push("No candidates left.");
    return { next: null, trace };
  }
  const [score, best] = scored[0];
  trace.push(`Next=${best.item_id} (EIG≈${score.toFixed(3)}, tag=${best.coverage_tag}, fam=${best.family})`);
  return { next: best, trace };
}

function mergeTwIntoItem(ajItem, tw) {
  // Attach-TW policy (simple): if Mechanism present & correct → upgrade completeness.
  if (!tw?.tw_labels) return ajItem;
  const twLab = tw.tw_labels;
  const mechGood = twLab.mech_present_correct >= 0.6;
  if (mechGood) {
    const labels = { ...(ajItem.labels || {}) };
    labels["Correct&Complete"] = Math.max(labels["Correct&Complete"] || 0, 0.9);
    labels["Correct_Missing"] = Math.min(labels["Correct_Missing"] || 0, 0.1);
    const cal = { ...(ajItem.calibrations || {}) };
    cal.p_correct = Math.max(cal.p_correct || 0, 0.85);
    return { ...ajItem, labels, calibrations: cal };
  }
  return ajItem;
}

export default async function handler(req, res) {
  try {
    const { itemId, ajMeasurement, twMeasurement } = req.body || {};
    const item = itemById(itemId);
    if (!item) return res.status(400).json({ error: "Unknown itemId" });

    const schemaFeat = bank.schema_features[item.schema_id] || {};
    const trace = [];

    // Merge TW if present (attach policy)
    const ajUsed = twMeasurement ? mergeTwIntoItem(ajMeasurement, twMeasurement) : ajMeasurement;
    if (twMeasurement) trace.push("Merged transcript-window evidence into item measurement.");

    // Policy & probe decision
    const { finalLabel, probe, trace: t1 } = finalizeLabelAndProbe(item, ajUsed, schemaFeat);
    trace.push(...t1);

    // Theta update
    const t2 = thetaUpdate(item, ajUsed);
    trace.push(...t2);

    // Update coverage & asked
    SESSION.asked.push(item.item_id);
    SESSION.coverage[item.coverage_tag] = (SESSION.coverage[item.coverage_tag] || 0) + 1;

    // Select next
    const { next, trace: t3 } = selectNextItem(item);
    trace.push(...t3);

    return res.status(200).json({
      final_label: finalLabel,
      probe_type: probe,
      next_item_id: next ? next.item_id : null,
      theta_mean: SESSION.theta_mean,
      theta_var: SESSION.theta_var,
      coverage_counts: SESSION.coverage,
      trace
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "turn error", details: String(err) });
  }
}

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

  // pitfalls
  const pit = aj.pitfalls || {};
  const highPit = Object.entries(pit).filter(([_, v]) => v >= CFG.tau_pitfall_hi).map(([k]) => k);
  if (highPit.length) trace.push(`High pitfalls: ${highPit.join(", ")}`);

  // required moves
  const req = (schemaFeatures?.required_moves) || [];
  const pm = aj.process_moves || {};
  let moveOK = true;
  for (const mv of req) {
    if ((pm[mv] || 0) < CFG.tau_required_move) moveOK = false;
  }
  if (req.length) trace.push(`Required moves present? ${moveOK} (need ≥${CFG.tau_required_move})`);

  // default probe by label
  let probe = "Alternative";
  if (finalLabel === "Correct&Complete") probe = "None";
  if (finalLabel === "Correct_Missing" || finalLabel === "Correct_Flawed") probe = "Mechanism";
  if (finalLabel === "Partial" || finalLabel === "Incorrect" || finalLabel === "Novel") probe = "Alternative";

  // C8: force Boundary if low-quality
  if (item.family.startsWith("C8") && ["Partial", "Incorrect", "Novel"].includes(finalLabel)) {
    probe = "Boundary";
    trace.push("Schema C8 → Boundary probe.");
  }

  // evidence sufficiency → skip probe
  const pComplete = labels["Correct&Complete"] || 0;
  const anyHiPit = highPit.length > 0;
  if (pComplete >= CFG.tau_complete && moveOK && !anyHiPit && conf >= CFG.tau_confidence) {
    probe = "None";
    trace.push("Evidence sufficient → skip probe.");
  }

  // C6 patch for bias direction
  if (CFG.enable_c6_patch && item.family.startsWith("C6")) {
    const direction = aj.extractions?.direction_word;
    const flawed = (labels["Correct_Flawed"] || 0) >= 0.2;
    const vague = (pit["direction_vague"] || 0) >= CFG.tau_pitfall_hi;
    if ((direction === "More" || direction === "Less") && !flawed && !vague) {
      probe = "None";
      trace.push("C6 patch → direction given, no flaw/vagueness → no probe.");
    }
  }

  // prefer Mechanism for low-quality (diagnostic)
  if (probe === "Alternative" && ["Partial", "Incorrect", "Novel"].includes(finalLabel) && !item.family.startsWith("C8")) {
    probe = "Mechanism";
    trace.push("Upgrade probe to Mechanism (diagnostic).");
  }

  return { finalLabel, probe, trace };
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

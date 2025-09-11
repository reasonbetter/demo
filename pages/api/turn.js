// pages/api/turn.js
import bank from "../../public/data/itemBank.json";

const CFG = {
  tau_complete: 0.70,
  tau_required_move: 0.60,
  tau_pitfall_hi: 0.30,
  tau_confidence: 0.75,
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

// simple in‑memory demo session
let SESSION = {
  theta_mean: 0,
  theta_var: 1.5,
  asked: [],
  coverage: {}
};

function sigmoid(x) {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  } else {
    const z = Math.exp(x);
    return z / (1 + z);
  }
}

function expectedScore(labels) {
  const m = CFG.score_map;
  return Object.entries(labels || {}).reduce((acc, [k, v]) => acc + (m[k] || 0) * v, 0);
}

function labelArgmax(labels) {
  let best = "Novel";
  let bestp = -1;
  for (const [k, v] of Object.entries(labels || {})) {
    if (v > bestp) {
      bestp = v;
      best = k;
    }
  }
  return [best, bestp];
}

function finalizeLabelAndProbe(item, aj, schemaFeatures) {
  const trace = [];

  const labels = aj?.labels || { Novel: 1.0 };
  const [finalLabel, pFinal] = labelArgmax(labels);
  const conf = aj?.calibrations?.confidence ?? 0.5;
  trace.push(`Argmax label=${finalLabel} (${pFinal.toFixed(2)}); AJ confidence=${conf.toFixed(2)}`);

  // pitfalls
  const pit = aj?.pitfalls || {};
  const highPit = Object.entries(pit)
    .filter(([, v]) => v >= CFG.tau_pitfall_hi)
    .map(([k]) => k);
  if (highPit.length) trace.push(`High pitfalls: ${highPit.join(", ")}`);

  // required moves (optional, schema-defined)
  const reqMoves = Array.isArray(schemaFeatures?.required_moves)
    ? schemaFeatures.required_moves
    : [];
  const pm = aj?.process_moves || {};
  let moveOK = true;
  for (const mv of reqMoves) {
    if ((pm[mv] || 0) < CFG.tau_required_move) moveOK = false;
  }
  if (reqMoves.length) {
    trace.push(`Required moves present? ${moveOK} (need ≥${CFG.tau_required_move})`);
  }

  // Prefer AJ‑authored probe (guard: short & present)
  let probeType = "None";
  let probeText = "";
  let probeSource = "policy";

  const ajIntent = aj?.probe?.intent || "None";
  const ajText = (aj?.probe?.text || "").trim();
  const wordCount = ajText ? ajText.split(/\s+/).length : 0;
  const useAjProbe = ajIntent !== "None" && ajText && wordCount <= 24;

  if (useAjProbe) {
    probeType = ajIntent;
    probeText = ajText;
    probeSource = "AJ";
    trace.push(`Using AJ probe intent=${ajIntent} (guard passed).`);
  } else {
    // fallback policy by label
    if (finalLabel === "Correct&Complete") {
      probeType = "None";
    } else if (finalLabel === "Correct_Missing" || finalLabel === "Correct_Flawed") {
      probeType = "Mechanism";
    } else {
      probeType = "Alternative";
    }
  }

  // Evidence sufficiency → skip probe
  const pComplete = labels["Correct&Complete"] || 0;
  if (pComplete >= CFG.tau_complete && moveOK && highPit.length === 0 && conf >= CFG.tau_confidence) {
    probeType = "None";
    probeText = "";
    probeSource = "policy";
    trace.push("Evidence sufficient → skip probe.");
  }

  return { finalLabel, probeType, probeText, probeSource, trace };
}

function fusePCorrect(theta, item, aj) {
  const a = item?.a ?? 1;
  const b = item?.b ?? 0;
  const pBase = sigmoid(a * ((theta ?? 0) - b));
  const pAj = aj?.calibrations?.p_correct;
  if (pAj == null) return { p: pBase, note: `p_base=${pBase.toFixed(3)}; no p_correct_AJ` };
  const p = 0.5 * pBase + 0.5 * pAj;
  return { p, note: `p_base=${pBase.toFixed(3)}; p_correct_AJ=${pAj.toFixed(3)}; p_fused=${p.toFixed(3)}` };
}

function thetaUpdate(item, aj) {
  const labels = aj?.labels || {};
  const yhat = expectedScore(labels);
  const { p, note } = fusePCorrect(SESSION.theta_mean, item, aj);
  const a = item?.a ?? 1;
  const info = (a ** 2) * p * (1 - p) + 1e-6;
  const thetaVarNew = 1.0 / (1.0 / SESSION.theta_var + info);
  const thetaMeanNew = SESSION.theta_mean + thetaVarNew * a * (yhat - p);
  const t = [
    note,
    `y_hat=${yhat.toFixed(3)}; info=${info.toFixed(3)}; θ: ${SESSION.theta_mean.toFixed(2)}→${thetaMeanNew.toFixed(2)}; var: ${SESSION.theta_var.toFixed(2)}→${thetaVarNew.toFixed(2)}`
  ];
  SESSION.theta_mean = thetaMeanNew;
  SESSION.theta_var = thetaVarNew;
  return t;
}

function eligibleCandidates() {
  const asked = new Set(SESSION.asked);
  return bank.items.filter((it) => !asked.has(it.item_id));
}

function applyCoverage(cands) {
  const need = CFG.coverage_targets.filter((tag) => (SESSION.coverage[tag] || 0) === 0);
  const prior = cands.filter((it) => need.includes(it.coverage_tag));
  return prior.length ? prior : cands;
}

function eigProxy(theta, it) {
  const a = it?.a ?? 1;
  const b = it?.b ?? 0;
  const p = sigmoid(a * ((theta ?? 0) - b));
  return (a ** 2) * p * (1 - p);
}

function selectNextItem() {
  const trace = [];
  let cands = eligibleCandidates();
  cands = applyCoverage(cands);
  cands.sort((x, y) => eigProxy(SESSION.theta_mean, y) - eigProxy(SESSION.theta_mean, x));
  const best = cands[0] || null;
  if (!best) {
    trace.push("No candidates left.");
    return { next: null, trace };
  }
  trace.push(
    `Next=${best.item_id} (EIG≈${eigProxy(SESSION.theta_mean, best).toFixed(3)}, tag=${best.coverage_tag}, fam=${best.family || "-"})`
  );
  return { next: best, trace };
}

function mergeTwIntoItem(ajItem, tw) {
  // If TW shows a decent mechanism, upgrade completeness a bit (safe, optional).
  try {
    const good = (tw?.process_moves?.mechanism_explained_well || 0) >= 0.6;
    if (!good) return ajItem;
    const labels = { ...(ajItem?.labels || {}) };
    labels["Correct&Complete"] = Math.max(labels["Correct&Complete"] || 0, 0.9);
    labels["Correct_Missing"] = Math.min(labels["Correct_Missing"] || 0, 0.1);
    const cal = { ...(ajItem?.calibrations || {}) };
    cal.p_correct = Math.max(cal.p_correct || 0, 0.85);
    return { ...ajItem, labels, calibrations: cal };
  } catch {
    return ajItem;
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { itemId, ajMeasurement, twMeasurement } = req.body || {};
    const item = bank.items.find((it) => it.item_id === itemId);
    if (!item) return res.status(400).json({ error: "Unknown itemId" });

    const schemaFeat =
      (bank.schema_features && item.schema_id && bank.schema_features[item.schema_id]) || {};

    const ajUsed = twMeasurement ? mergeTwIntoItem(ajMeasurement, twMeasurement) : ajMeasurement;

    const { finalLabel, probeType, probeText, probeSource, trace: t1 } =
      finalizeLabelAndProbe(item, ajUsed, schemaFeat);

    const t2 = thetaUpdate(item, ajUsed);

    // update session state
    SESSION.asked.push(item.item_id);
    SESSION.coverage[item.coverage_tag] = (SESSION.coverage[item.coverage_tag] || 0) + 1;

    const { next, trace: t3 } = selectNextItem();
    const trace = [...t1, ...t2, ...t3];

    return res.status(200).json({
      final_label: finalLabel,
      probe_type: probeType,
      probe_text: probeText,
      probe_source: probeSource,
      next_item_id: next ? next.item_id : null,
      theta_mean: SESSION.theta_mean,
      theta_var: SESSION.theta_var,
      coverage_counts: SESSION.coverage,
      trace
    });
  } catch (err) {
    console.error("turn error:", err);
    return res
      .status(500)
      .json({ error: "turn error", details: err.message, stack: String(err.stack || "") });
  }
}

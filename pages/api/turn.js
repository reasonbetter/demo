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

// ---- helpers ---------------------------------------------------------------

// numeric coerce with fallback
function toNum(x, d = 0) {
  const n = typeof x === "number" ? x : parseFloat(x);
  return Number.isFinite(n) ? n : d;
}
function expectedListNFor(item, schemaFeatures) {
  // Prefer schema config; otherwise infer for the C1 family
  if (schemaFeatures && Number.isFinite(schemaFeatures.expected_list_count)) {
    return schemaFeatures.expected_list_count;
  }
  return item?.family?.startsWith("C1") ? 2 : null;
}

// If AJ found the required number of list items but labels are weak/missing,
// patch the measurement so scoring & routing remain fair.
function patchMeasurementForLists(item, aj, schemaFeatures) {
  try {
    const need = expectedListNFor(item, schemaFeatures);
    if (!need) return aj;
    const rc = toNum(aj?.extractions?.reasons_count, 0);
    if (rc < need) return aj;

    const labels = { ...(aj?.labels || {}) };
    // If AJ under-labeled (e.g., Novel/Partial), upgrade to at least Correct_Missing.
    const cm = Math.max(toNum(labels["Correct_Missing"], 0), 0.75);
    labels["Correct_Missing"] = cm;
    labels["Partial"] = Math.min(toNum(labels["Partial"], 0), 0.20);
    labels["Novel"] = 0.0;

    const cal = { ...(aj?.calibrations || {}) };
    cal.p_correct = Math.max(toNum(cal.p_correct, 0), 0.65);

    return { ...aj, labels, calibrations: cal, _patched: "list_count_satisfied" };
  } catch {
    return aj;
  }
}

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
  let sum = 0;
  for (const [k, v] of Object.entries(labels || {})) {
    sum += (m[k] || 0) * toNum(v, 0);
  }
  return sum;
}

function labelArgmax(labels) {
  let best = "Novel";
  let bestp = -1;
  for (const [k, v] of Object.entries(labels || {})) {
    const p = toNum(v, -1);
    if (p > bestp) {
      bestp = p;
      best = k;
    }
  }
  return [best, bestp];
}

// ---- core policy -----------------------------------------------------------

function finalizeLabelAndProbe(item, aj, schemaFeatures) {
  const trace = [];

  const labels = aj?.labels || { Novel: 1.0 };
  const [finalLabel, pFinalRaw] = labelArgmax(labels);
  const pFinal = toNum(pFinalRaw, 0);
  const conf = toNum(aj?.calibrations?.confidence, 0.5);
  trace.push(
    `Argmax label=${finalLabel} (${pFinal.toFixed(2)}); AJ confidence=${conf.toFixed(2)}`
  );

  // pitfalls
  const pit = aj?.pitfalls || {};
  const highPit = Object.entries(pit)
    .filter(([, v]) => toNum(v, 0) >= CFG.tau_pitfall_hi)
    .map(([k]) => k);
  if (highPit.length) trace.push(`High pitfalls: ${highPit.join(", ")}`);

  // required moves (optional, schema-defined)
  const reqMoves = Array.isArray(schemaFeatures?.required_moves)
    ? schemaFeatures.required_moves
    : [];
  const pm = aj?.process_moves || {};
  let moveOK = true;
  for (const mv of reqMoves) {
    if (toNum(pm[mv], 0) < CFG.tau_required_move) moveOK = false;
  }
  if (reqMoves.length) {
    trace.push(`Required moves present? ${moveOK} (need ≥${CFG.tau_required_move})`);
  }

  // Prefer AJ‑authored probe (guard: present & short)
  let probeType = "None";
  let probeText = "";
  let probeSource = "policy";

  const ajIntent = aj?.probe?.intent || "None";
  const ajText = (aj?.probe?.text || "").trim();
  const useAjProbe = ajIntent !== "None" && ajText && ajText.split(/\s+/).length <= 24;

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
  const pComplete = toNum(labels["Correct&Complete"], 0);
  if (pComplete >= CFG.tau_complete && moveOK && highPit.length === 0 && conf >= CFG.tau_confidence) {
    probeType = "None";
    probeText = "";
    probeSource = "policy";
    trace.push("Evidence sufficient → skip probe.");
  }
try {
  const need = expectedListNFor(item, schemaFeatures);
  const rc = toNum(aj?.extractions?.reasons_count, 0);
  if (need && rc >= need && probeType === "Completion") {
    probeType = "None";
    probeText = "";
    probeSource = "policy";
    trace.push(`Completion satisfied via AJ extraction (reasons_count=${rc}) → no probe.`);
  }
} catch {}
  return { finalLabel, probeType, probeText, probeSource, trace };
}

function fusePCorrect(theta, item, aj) {
  const a = toNum(item?.a, 1);
  const b = toNum(item?.b, 0);
  const pBase = sigmoid(a * (toNum(theta, 0) - b));
  const pAj = aj?.calibrations?.p_correct;
  const pAjNum = toNum(pAj, NaN);
  if (!Number.isFinite(pAjNum)) {
    return { p: pBase, note: `p_base=${pBase.toFixed(3)}; no p_correct_AJ` };
  }
  const p = 0.5 * pBase + 0.5 * pAjNum;
  return { p, note: `p_base=${pBase.toFixed(3)}; p_correct_AJ=${pAjNum.toFixed(3)}; p_fused=${p.toFixed(3)}` };
}

function thetaUpdate(item, aj) {
  const labels = aj?.labels || {};
  const yhat = expectedScore(labels); // already numeric
  const { p, note } = fusePCorrect(SESSION.theta_mean, item, aj);
  const a = toNum(item?.a, 1);
  const info = (a ** 2) * p * (1 - p) + 1e-6;
  const thetaVarNew = 1.0 / (1.0 / toNum(SESSION.theta_var, 1.5) + info);
  const thetaMeanNew = toNum(SESSION.theta_mean, 0) + thetaVarNew * a * (yhat - p);

  const t = [
    note,
    `y_hat=${yhat.toFixed(3)}; info=${info.toFixed(3)}; θ: ${toNum(SESSION.theta_mean, 0).toFixed(2)}→${thetaMeanNew.toFixed(2)}; var: ${toNum(SESSION.theta_var, 1.5).toFixed(2)}→${thetaVarNew.toFixed(2)}`
  ];
  SESSION.theta_mean = thetaMeanNew;
  SESSION.theta_var = thetaVarNew;
  return t;
}

// ---- routing ----------------------------------------------------------------

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
  const a = toNum(it?.a, 1);
  const b = toNum(it?.b, 0);
  const p = sigmoid(a * (toNum(theta, 0) - b));
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

// ---- TW merge ---------------------------------------------------------------

function mergeTwIntoItem(ajItem, tw) {
  try {
    const good = toNum(tw?.process_moves?.mechanism_explained_well, 0) >= 0.6;
    if (!good) return ajItem;
    const labels = { ...(ajItem?.labels || {}) };
    labels["Correct&Complete"] = Math.max(toNum(labels["Correct&Complete"], 0), 0.9);
    labels["Correct_Missing"] = Math.min(toNum(labels["Correct_Missing"], 0), 0.1);
    const cal = { ...(ajItem?.calibrations || {}) };
    cal.p_correct = Math.max(toNum(cal.p_correct, 0), 0.85);
    return { ...ajItem, labels, calibrations: cal };
  } catch {
    return ajItem;
  }
}

// ---- API route --------------------------------------------------------------

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { itemId, ajMeasurement, twMeasurement } = req.body || {};
    const item = bank.items.find((it) => it.item_id === itemId);
    if (!item) return res.status(400).json({ error: "Unknown itemId" });

    const schemaFeat =
      (bank.schema_features && item.schema_id && bank.schema_features[item.schema_id]) || {};

let ajUsed = twMeasurement ? mergeTwIntoItem(ajMeasurement, twMeasurement) : ajMeasurement;
ajUsed = patchMeasurementForLists(item, ajUsed, schemaFeat);

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

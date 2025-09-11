export const config = { runtime: 'nodejs' };

import bank from "../../public/data/itemBank.json";
import { sql } from "../../lib/db.js";

// ---------- helpers (same math you already use) ----------
function sigmoid(x) { if (x >= 0) { const z = Math.exp(-x); return 1/(1+z); } else { const z = Math.exp(x); return z/(1+z); } }
function itemById(id) { return bank.items.find((it) => it.item_id === id); }
function expectedScore(labels = {}) {
  const m = {
    "Correct&Complete": 1.0, "Correct_Missing": 0.85, "Correct_Flawed": 0.60,
    "Partial": 0.40, "Incorrect": 0.0, "Novel": 0.0
  };
  return Object.entries(labels).reduce((acc,[k,v]) => acc + (m[k]||0)*v, 0);
}
function labelArgmax(labels = {}) { let best="Novel", bestp=-1; for (const [k,v] of Object.entries(labels)) if (v>bestp) { best=k; bestp=v; } return [best,bestp]; }
function eigProxy(theta, it) { const p = sigmoid(it.a * (theta - it.b)); return (it.a**2) * p * (1-p); }
function fusePCorrect(theta, item, aj) {
  const pBase = sigmoid(item.a * (theta - item.b));
  const pAj = aj?.calibrations?.p_correct;
  if (pAj == null) return { p: pBase, note: `p_base=${pBase.toFixed(3)}; no p_correct_AJ` };
  const p = 0.5*pBase + 0.5*pAj;
  return { p, note: `p_base=${pBase.toFixed(3)}; p_correct_AJ=${pAj.toFixed(3)}; p_fused=${p.toFixed(3)}` };
}
function mergeTwIntoItem(ajItem, tw) {
  if (!tw?.tw_labels) return ajItem;
  const mechGood = tw.tw_labels.mech_present_correct >= 0.6;
  if (mechGood) {
    const labels = { ...(ajItem.labels || {}) };
    labels["Correct&Complete"] = Math.max(labels["Correct&Complete"]||0, 0.9);
    labels["Correct_Missing"]  = Math.min(labels["Correct_Missing"]||0,  0.1);
    const cal = { ...(ajItem.calibrations || {}) };
    cal.p_correct = Math.max(cal.p_correct || 0, 0.85);
    return { ...ajItem, labels, calibrations: cal };
  }
  return ajItem;
}
function finalizeLabelAndProbe(item, aj /*, schemaFeatures */) {
  const trace = [];
  const labels = aj.labels || { Novel: 1.0 };
  const [finalLabel, pFinal] = labelArgmax(labels);
  const conf = aj.calibrations?.confidence ?? 0.5;
  trace.push(`Argmax label=${finalLabel} (${pFinal.toFixed(2)}); AJ confidence=${conf.toFixed(2)}`);

  let probe = "Alternative";
  if (finalLabel === "Correct&Complete") probe = "None";
  if (finalLabel === "Correct_Missing" || finalLabel === "Correct_Flawed") probe = "Mechanism";
  if (finalLabel === "Partial" || finalLabel === "Incorrect" || finalLabel === "Novel") probe = "Alternative";

  // Simple sufficiency cutoff
  const pComplete = labels["Correct&Complete"] || 0;
  if (pComplete >= 0.70) { probe = "None"; trace.push("Evidence sufficient → skip probe."); }
  return { finalLabel, probe, trace };
}
function thetaUpdate(theta_mean, theta_var, item, aj) {
  const labels = aj.labels || {};
  const yhat = expectedScore(labels);
  const { p, note } = fusePCorrect(theta_mean, item, aj);
  const info = (item.a**2) * p * (1 - p) + 1e-6;
  const thetaVarNew = 1.0 / (1.0/theta_var + info);
  const thetaMeanNew = theta_mean + thetaVarNew * item.a * (yhat - p);
  const trace = [
    note,
    `y_hat=${yhat.toFixed(3)}; info=${info.toFixed(3)}; θ: ${theta_mean.toFixed(2)}→${thetaMeanNew.toFixed(2)}; var: ${theta_var.toFixed(2)}→${thetaVarNew.toFixed(2)}`
  ];
  return { thetaMeanNew, thetaVarNew, trace };
}

// ---------- API route ----------
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { session_id, user_tag, itemId, ajMeasurement, twMeasurement } = req.body || {};
    if (!session_id || !itemId || !ajMeasurement) {
      return res.status(400).json({ error: "Missing session_id, itemId, or ajMeasurement" });
    }
    const item = itemById(itemId);
    if (!item) return res.status(400).json({ error: "Unknown itemId" });

    const ajUsed = twMeasurement ? mergeTwIntoItem(ajMeasurement, twMeasurement) : ajMeasurement;

    const result = await sql.begin(async (tx) => {
      // Lock or create session
      let sess = await tx`SELECT * FROM sessions WHERE id = ${session_id} FOR UPDATE`;
      if (sess.rowCount === 0) {
        await tx`INSERT INTO sessions (id, user_tag) VALUES (${session_id}, ${user_tag || null})`;
        sess = await tx`SELECT * FROM sessions WHERE id = ${session_id} FOR UPDATE`;
      }
      const s = sess.rows[0];
      let theta_mean = Number(s.theta_mean);
      let theta_var  = Number(s.theta_var);
      const askedArr = Array.isArray(s.asked) ? s.asked : [];
      const coverage = s.coverage || { confounding:0, temporality:0, complexity:0 };

      const trace = [];
      const { finalLabel, probe, trace: t1 } = finalizeLabelAndProbe(item, ajUsed);
      trace.push(...t1);

      const { thetaMeanNew, thetaVarNew, trace: t2 } = thetaUpdate(theta_mean, theta_var, item, ajUsed);
      theta_mean = thetaMeanNew; theta_var = thetaVarNew;
      trace.push(...t2);

      // Select next item (EIG proxy), excluding already asked + this one
      const askedSet = new Set([...askedArr, item.item_id]);
      const candidates = bank.items.filter(it => !askedSet.has(it.item_id));
      const scored = candidates.map(it => [eigProxy(theta_mean, it), it]).sort((a,b) => b[0]-a[0]);
      const next = scored.length ? scored[0][1] : null;
      if (next) trace.push(`Next=${next.item_id} (EIG≈${eigProxy(theta_mean,next).toFixed(3)}, tag=${next.coverage_tag}, fam=${next.family})`);
      else trace.push("No candidates left.");

      // Update coverage in JS to avoid jsonb path gymnastics
      const coverageUpdated = { ...coverage };
      const key = item.coverage_tag;
      coverageUpdated[key] = (coverageUpdated[key] || 0) + 1;

      // Update session row
      await tx`
        UPDATE sessions
           SET theta_mean = ${theta_mean},
               theta_var  = ${theta_var},
               asked      = (SELECT ARRAY(SELECT DISTINCT unnest(asked || ${[item.item_id]}::text[]))),
               coverage   = ${JSON.stringify(coverageUpdated)}::jsonb,
               user_tag   = COALESCE(${user_tag || null}, user_tag)
         WHERE id = ${session_id}
      `;

      // Insert turn row
      const ajJson = JSON.stringify(ajUsed);
      const twJson = twMeasurement ? JSON.stringify(twMeasurement) : null;
      await tx`
        INSERT INTO turns
          (session_id, item_id, family, coverage_tag, label, probe_type, probe_text,
           aj_json, tw_json, theta_mean_after, theta_var_after)
        VALUES
          (${session_id}, ${item.item_id}, ${item.family}, ${item.coverage_tag}, ${finalLabel}, ${probe}, ${''},
           ${ajJson}::jsonb, ${twJson}::jsonb, ${theta_mean}, ${theta_var})
      `;

      return {
        final_label: finalLabel,
        probe_type: probe,
        next_item_id: next ? next.item_id : null,
        theta_mean, theta_var,
        coverage_counts: coverageUpdated,
        trace
      };
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "turn error", details: String(err) });
  }
}

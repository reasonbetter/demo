import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Minimal AJ prompt (same logic you approved), trimmed to fit demo
const AJ_SYSTEM = `You are the Adaptive Judge. Measure the quality of a user's answer. Return JSON only.
- Score content only; ignore grammar/dialect/style.
- For items: labels = {Correct&Complete, Correct_Missing, Correct_Flawed, Partial, Incorrect, Novel}.
- For transcript windows (tw_type present): use tw_labels according to tw_type:
  Mechanism: {mech_present_correct, mech_present_wrong_direction, mech_absent, buzzword_only}
  Alternative: {alt_present_distinct, alt_present_overlap, alt_absent, buzzword_only}
  Boundary: {boundary_valid_specific, boundary_trivial_or_tautology, boundary_absent, buzzword_only}
- pitfalls/process_moves: probabilities 0–1.
- calibrations: include p_correct (items only) and confidence 0–1.
- extractions: direction_word ("More"/"Less"/null) and up to two key_phrases.
- Output JSON only.`;

function ajUserPrompt({ item, userResponse, features }) {
  const { tw_type, schema_id, item_id, family, coverage_tag, band, item_params, schema_features } = features || {};
  const stim = item?.text || "";
  const feats = {
    schema_id, item_id, family, coverage_tag, band, item_params, schema_features, tw_type
  };
  return `Stimulus:\n${stim}\n\nUser response:\n${userResponse}\n\nFeatures JSON:\n${JSON.stringify(feats)}`;
}

export default async function handler(req, res) {
  try {
    const { item, userResponse, features } = req.body || {};
    const userMsg = ajUserPrompt({ item, userResponse, features });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: AJ_SYSTEM },
        { role: "user", content: userMsg }
      ],
      response_format: { type: "json_object" }
    });

    const text = completion.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(text);
    res.status(200).json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AJ error", details: String(err) });
  }
}

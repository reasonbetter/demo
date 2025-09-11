import OpenAI from "openai";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export default async function handler(req, res) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const { item, userResponse, features } = req.body || {};
    if (!item?.text || typeof userResponse !== "string") {
      return res.status(400).json({ error: "Bad request: missing item.text or userResponse" });
    }

    const AJ_SYSTEM = `You are the Adaptive Judge. Measure the quality of a user's answer. Return JSON only.
- Score content only; ignore grammar/dialect/style.
- For items: labels={Correct&Complete, Correct_Missing, Correct_Flawed, Partial, Incorrect, Novel}.
- For TWs (features.tw_type present), use tw_labels according to tw_type (Mechanism/Alternative/Boundary).
- pitfalls/process_moves: probabilities 0–1.
- calibrations: include p_correct (items only) and confidence 0–1.
- extractions: direction_word ("More"/"Less"/null) and up to two key_phrases.
- Output JSON only.`;

    const userMsg = `Stimulus:\n${item.text}\n\nUser response:\n${userResponse}\n\nFeatures JSON:\n${JSON.stringify(features || {})}`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: AJ_SYSTEM },
        { role: "user", content: userMsg }
      ],
      response_format: { type: "json_object" }
    });

    let text = completion.choices?.[0]?.message?.content || "{}";
    let payload;
    try { payload = JSON.parse(text); }
    catch {
      // If the model forgot to emit JSON, wrap as Novel
      payload = {
        labels: { Novel: 1.0 },
        pitfalls: {},
        process_moves: {},
        calibrations: { p_correct: 0.0, confidence: 0.2 },
        extractions: { direction_word: null, key_phrases: [] }
      };
    }
    return res.status(200).json(payload);
  } catch (err) {
    console.error("AJ error:", err);
    return res.status(500).json({ error: "AJ error", details: String(err) });
  }
}

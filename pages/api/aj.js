import OpenAI from "openai";

const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini"; 

export default async function handler(req, res) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { item, userResponse, features } = req.body || {};
    if (!item?.text || typeof userResponse !== "string") {
      return res.status(400).json({ error: "Bad request: missing item.text or userResponse" });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const AJ_SYSTEM = `You are the Adaptive Judge.

TASK 1 — MEASUREMENT:
Return JSON with:
- labels: probabilities over {"Correct&Complete","Correct_Missing","Correct_Flawed","Partial","Incorrect","Novel"}
- pitfalls: object of probabilities (0–1), use concise keys (e.g., only_one_reason_given)
- process_moves: object of probabilities (0–1)
- calibrations: { p_correct: number, confidence: number }
- extractions: { direction_word: "More"|"Less"|null, key_phrases: string[] }

TASK 2 — PROBE RECOMMENDATION:
Also return a "probe" object with:
- intent: one of {"None","Completion","Mechanism","Alternative","Clarify","Boundary"}
- text: a single-sentence probe ≤ 20 words, plain language, no jargon
- rationale: 1 short phrase explaining why this probe (for logs)
- confidence: 0–1

GENERAL POLICIES:
- Do NOT use technical terms (e.g., "confounder","mediator","collider","selection bias","reverse causation").
- Do NOT reveal or cue the target concept or answer.
- If features.expected_list_count = N and user provided fewer distinct items, set intent="Completion" and ask for “one more different reason.”
- Only extract direction_word when features.expect_direction_word === true; otherwise set null.
- If you are not confident a probe is needed, set intent="None" and empty text.

Output strict JSON only.
`;

    const userMsg = {
      stimulus: item.text,
      user_response: userResponse,
      features: features || {}
    };

    // Try Responses API first (new SDK), fall back to Chat Completions if needed
    let text;
    try {
      if (typeof client.responses?.create === "function") {
        const r = await client.responses.create({
          model: MODEL,
          input: [
            { role: "system", content: AJ_SYSTEM },
            { role: "user", content: JSON.stringify(userMsg) }
          ],
          response_format: { type: "json_object" },
        });
        text = r.output_text;
      } else {
        const r = await client.chat.completions.create({
          model: MODEL,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: AJ_SYSTEM },
            { role: "user", content: JSON.stringify(userMsg) }
          ]
        });
        text = r?.choices?.[0]?.message?.content;
      }
    } catch (apiErr) {
      return res.status(502).json({
        error: "OpenAI call failed",
        details: apiErr?.message || String(apiErr)
      });
    }

    if (!text || typeof text !== "string") {
      return res.status(502).json({ error: "Empty response from model" });
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: "Model returned non-JSON",
        sample: text.slice(0, 800)
      });
    }

    return res.status(200).json(payload);
  } catch (err) {
    console.error("AJ route error:", err);
    return res.status(500).json({ error: "AJ route error", details: String(err) });
  }
}

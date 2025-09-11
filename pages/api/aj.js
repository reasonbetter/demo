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
Return JSON ONLY with fields:
- labels: object of probabilities over { "Correct&Complete", "Correct_Missing", "Correct_Flawed", "Partial", "Incorrect", "Novel" }
- pitfalls: object of probabilities
- process_moves: object of probabilities
- calibrations: { p_correct: number, confidence: number }
- extractions: { direction_word: "More"|"Less"|null, key_phrases: string[] }`;

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
          temperature: 1
        });
        text = r.output_text;
      } else {
        const r = await client.chat.completions.create({
          model: MODEL,
          temperature: 1,
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

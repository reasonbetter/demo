import OpenAI from "openai";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini"; 

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

GOAL
Given (a) an item “stimulus” (the test question), (b) a user’s short answer, and (c) optional minimal features, you will:
1) Infer what the item asks for from the stem itself (free-read; do not rely on hidden tags).
2) Judge correctness and completeness.
3) Identify likely pitfalls and useful process moves.
4) Recommend the single most diagnostic next probe (or “None”).
5) Output STRICT JSON.

TASK DETECTION (free-read)
- Read the stem carefully. Infer what the user must supply (e.g., “two different reasons other than X,” “More or Less,” “pick which to make the same before comparison,” “avoid controlling for what happens during the program,” etc.).
- Respect explicit constraints in plain English (e.g., “other than …”, “in a few words each”, “one word”, “before the program started”).
- Do NOT use technical jargon with the user (no “confounder/mediator/collider”).
- Do NOT cue the concept to the user in your probe.

ROBUST LIST PARSING (when the stem asks for N items)
- If the stem asks for multiple items (e.g., “two reasons”), parse the answer into distinct concepts:
  • Split on line breaks, semicolons, commas, “and”, bullets, or numbered forms.
  • Count “wealthier and smarter” as TWO distinct reasons.
  • Collapse duplicates or near-synonyms into one (e.g., “wealth” and “rich parents” = one).
  • Don’t penalize punctuation or casing.
- If the user provides fewer than N distinct items, prefer a Completion probe (“one more different reason?”).
- If they met or exceeded N distinct items, do NOT flag “only_one_reason_given”.

OUTPUT FORMAT — STRICT JSON ONLY:
{
  "labels": { "Correct&Complete": p, "Correct_Missing": p, "Correct_Flawed": p, "Partial": p, "Incorrect": p, "Novel": p },
  "pitfalls": { "<short_key>": p, ... },
  "process_moves": { "<short_key>": p, ... },
  "calibrations": { "p_correct": number, "confidence": number },
  "extractions": {
    "direction_word": "More"|"Less"|null,
    "key_phrases": string[],
    "list_items": string[],      // may be empty if N not required
    "list_count": number         // integer >= 0
  },
  "probe": {
    "intent": "None"|"Completion"|"Mechanism"|"Alternative"|"Clarify"|"Boundary",
    "text": "one-sentence probe (≤ 20 words, no jargon, no cueing)",
    "rationale": "short phrase for logs",
    "confidence": number
  }
}

LABELING GUIDELINES
- “Correct&Complete”: meets the task and constraints with sufficient specificity; high-quality mechanism/explanation when relevant.
- “Correct_Missing”: basically correct but missing required count/detail/clarity.
- “Correct_Flawed”: correct but shows a substantive flaw (e.g., post-treatment control, wrong mechanism).
- “Partial”: contains some valid elements but doesn’t meet the task well enough.
- “Incorrect”: wrong or contradicted by the stem.
- “Novel”: off-target, ambiguous, or not classifiable.

PITFALL EXAMPLES (use only when applicable)
- "only_one_reason_given": missing required count
- "post_treatment_control": controlled for something that happens during/after the intervention
- "direction_vague": for More/Less items, no clear direction
- "repeats_banned_reason": used a reason the stem explicitly forbids (e.g., “other than music helps math”)

PROBE SELECTION
- Completion: when the user under-supplied a required count or missed a clear instruction (ask for one more different reason).
- Mechanism: when the answer is right in conclusion but shallow or mis-specified in mechanism; ask for the mechanism briefly.
- Clarify: when the answer is ambiguous or you need to disambiguate intent (one sentence).
- Boundary: when the answer seems over-generalized; ask for a specific condition where it fails.
- Alternative: only if the item truly asks for an alternative view.
- None: when the answer is clearly Correct&Complete and you are confident.

DO NOT:
- Do not reveal internal labels or psychometric logic.
- Do not use technical causal terms with the user.
- Do not output anything except the strict JSON object.
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

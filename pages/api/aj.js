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

TASK 1 — MEASUREMENT (strict JSON):
Return a JSON object with keys:
- labels: probabilities over {"Correct&Complete","Correct_Missing","Correct_Flawed","Partial","Incorrect","Novel"}.
  * All six keys MUST be present.
  * Values MUST be numeric in [0,1] and sum to ≈1.0 (±0.01). If unsure, distribute mass conservatively.
- pitfalls: object of probabilities (0–1). Use concise snake_case keys (e.g., only_one_reason_given).
- process_moves: object of probabilities (0–1). Use concise snake_case keys.
- calibrations: { p_correct: number in [0,1], confidence: number in [0,1] }.
- extractions:
  {
    direction_word: "More"|"Less"|null,
    key_phrases: string[],
    reasons: string[],            // parsed list items when the prompt asks for “two reasons”
    reasons_count: number         // integer length of reasons
  }

TASK 2 — PROBE RECOMMENDATION:
Also include a "probe" object:
- intent: one of {"None","Completion","Mechanism","Alternative","Clarify","Boundary"}.
- text: a single-sentence probe ≤ 20 words, plain language, no jargon.
- rationale: short phrase explaining why this probe (for logs).
- confidence: number in [0,1].

PARSING RULES FOR LIST PROMPTS:
- If features.expected_list_count = N, parse the user's response into N-ish separate reasons.
- Split on punctuation (, ; ·), line breaks, and conjunctions ("and", "and also"), but ONLY count semantically distinct ideas.
  Example: "wealthier and more involved parents" → reasons=["wealthier parents","more involved parents"] (count = 2).
- Be generous to the user: if a clause clearly contains two distinct constructs (e.g., wealth vs involvement), count them separately.
- Return extractions.reasons (array of short phrases) and extractions.reasons_count (integer).
- Do not penalize style, grammar, or dialect.

GENERAL POLICIES:
- No technical terms ("confounder","mediator","collider","reverse causation","selection bias").
- Do NOT cue the target concept.
- Only extract direction_word when features.expect_direction_word === true; otherwise set null.
- If features.expected_list_count = N and reasons_count < N, set probe.intent="Completion" with a polite single-sentence request for “one more different reason”.
- If you are not confident a probe is needed, set intent="None" and an empty text.

Output STRICT JSON only. No prose, no markdown.`;

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

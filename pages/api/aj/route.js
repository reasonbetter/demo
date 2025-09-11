// app/api/aj/route.js
export const runtime = 'edge';                      // ← Edge runtime
export const preferredRegion = ['iad1', 'cle1'];    // ← Close to Ann Arbor/US East

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'; 
// Tip: try 4o-mini first for latency. If you prefer gpt-5-mini reliability, set OPENAI_MODEL in Vercel.

const AJ_SYSTEM = `You are the Adaptive Judge.

Return STRICT JSON with:
- labels: probs for {"Correct&Complete","Correct_Missing","Correct_Flawed","Partial","Incorrect","Novel"}; 6 keys, [0,1], sum≈1.0
- pitfalls: {snake_case_key: prob}
- process_moves: {snake_case_key: prob}
- calibrations: { p_correct: [0,1], confidence: [0,1] }
- extractions: {
    direction_word: "More"|"Less"|null,
    key_phrases: string[],
    reasons: string[],        // parsed when a list is expected
    reasons_count: number     // length of reasons
  }
- probe: {
    intent: "None"|"Completion"|"Mechanism"|"Alternative"|"Clarify"|"Boundary",
    text: string,         // ≤ 20 words, plain language, no jargon
    rationale: string,    // short phrase
    confidence: [0,1]
  }

LIST PARSING (when features.expected_list_count = N):
- Split the user's text into distinct reasons. Treat a clause like
  "wealthier and more involved parents" as TWO items:
  ["wealthier parents","more involved parents"].
- Be generous; count semantically distinct ideas, not grammar.
- Set extractions.reasons (array) and reasons_count (integer).

POLICIES:
- No technical terms (confounder/mediator/collider/reverse causation/selection bias).
- Don’t cue the answer.
- Only set direction_word when features.expect_direction_word === true; else null.
- If expected_list_count is set and reasons_count < N → probe.intent="Completion" with a polite “one more different reason” prompt.
- If not confident a probe is needed → intent="None" and empty text.

Output STRICT JSON only.`;

export async function POST(req) {
  try {
    const { item, userResponse, features } = await req.json();
    if (!item?.text || typeof userResponse !== 'string') {
      return new Response(JSON.stringify({ error: 'Bad request: missing item.text or userResponse' }), { status: 400 });
    }

    // Keep the user payload small for latency:
    const smallFeatures = {
      schema_id: features?.schema_id,
      expected_list_count: features?.expected_list_count ?? null,
      expect_direction_word: !!features?.expect_direction_word,
      tw_type: features?.tw_type ?? null
    };

    const body = {
      model: MODEL,
      // Responses API works well on Edge and supports json_object formatting
      input: [
        { role: "system", content: AJ_SYSTEM },
        { role: "user", content: JSON.stringify({
            stimulus: item.text,
            user_response: userResponse,
            features: smallFeatures
        }) }
      ],
      response_format: { type: "json_object" },
      max_output_tokens: 280
    };

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      // Abort fast if the upstream stalls; tune as you like:
      // signal: AbortSignal.timeout(6500)
    });

    if (!r.ok) {
      const errText = await r.text();
      return new Response(JSON.stringify({ error: "OpenAI call failed", details: errText.slice(0, 800) }), { status: 502 });
    }

    const data = await r.json();
    const text = data.output_text || data.choices?.[0]?.message?.content || "";
    if (!text) {
      return new Response(JSON.stringify({ error: "Empty AJ output", data }), { status: 502 });
    }

    let payload;
    try { payload = JSON.parse(text); }
    catch {
      return new Response(JSON.stringify({ error: "Non-JSON AJ output", sample: text.slice(0, 800) }), { status: 502 });
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "AJ edge error", details: String(err) }), { status: 500 });
  }
}

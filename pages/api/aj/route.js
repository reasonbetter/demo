// app/api/aj/route.js
import { AJ_SYSTEM } from '../../../lib/prompts/aj.system.js';
export const runtime = 'edge';
export const preferredRegion = ['iad1', 'cle1']; // closer to Ann Arbor / US East

const MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';

export async function POST(req) {
  try {
    const { item, userResponse, features } = await req.json();
    if (!item?.text || typeof userResponse !== 'string') {
      return new Response(JSON.stringify({ error: 'Bad request: missing item.text or userResponse' }), { status: 400 });
    }

    // Keep features small for latency
    const smallFeatures = {
      schema_id: features?.schema_id ?? null,
      expected_list_count: features?.expected_list_count ?? null,
      expect_direction_word: !!features?.expect_direction_word,
      tw_type: features?.tw_type ?? null
    };

    const body = {
      model: MODEL,
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
      body: JSON.stringify(body)
      // Optional hard timeout:
      //, signal: AbortSignal.timeout(6500)
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

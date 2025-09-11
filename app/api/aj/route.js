// app/api/aj/route.js
export const runtime = 'edge';
import { AJ_SYSTEM } from '../../../lib/prompts/aj.system.js';

export async function POST(req) {
  try {
    const { item, userResponse, features } = await req.json();

    if (!item?.text || typeof userResponse !== 'string') {
      return new Response(JSON.stringify({ error: 'Bad request' }), { status: 400 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: 'Missing OPENAI_API_KEY' }), { status: 500 });
    }

    // Guard: ensure the system prompt actually arrived as a string
    if (typeof AJ_SYSTEM !== 'string' || AJ_SYSTEM.length < 20) {
      return new Response(JSON.stringify({ error: 'AJ_SYSTEM not a valid string (check export/import)' }), { status: 500 });
    }

    const model = process.env.OPENAI_MODEL || 'gpt-5-mini';

    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        text: { format: { type: 'json_object' } },
        max_output_tokens: 700,        // Responses API key
        reasoning: { effort: "low" },
        input: [
          {
            role: 'system',
            content: [
              { type: 'input_text', text: AJ_SYSTEM } // <— MUST be present
            ]
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify({
                  stimulus: item.text,
                  user_response: userResponse,
                  features: features || {}
                })
              }
            ]
          }
        ]
      })
    });

    const data = await r.json();

// 1) If the run didn’t complete, return a clear 502 with details
if (data?.status && data.status !== "completed") {
  return new Response(
    JSON.stringify({
      error: "Model returned incomplete response",
      status: data.status,
      incomplete_details: data.incomplete_details || null
    }),
    { status: 502 }
  );
}

// 2) Robustly extract the text payload
let text = data?.output_text || "";
if (!text && Array.isArray(data?.output)) {
  const msg = data.output.find(o => o.type === "message");
  const seg = msg?.content?.find(c => c.type === "output_text");
  text = seg?.text || "";
}

if (!text) {
  return new Response(
    JSON.stringify({
      error: "Model returned empty output_text",
      sample: JSON.stringify(data).slice(0, 500)
    }),
    { status: 502 }
  );
}

let payload;
try {
  payload = JSON.parse(text);
} catch {
  return new Response(
    JSON.stringify({ error: "Model returned non-JSON", sample: text.slice(0, 800) }),
    { status: 502 }
  );
}

return new Response(JSON.stringify(payload), {
  status: 200,
  headers: { "Content-Type": "application/json" }
});


export async function GET() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

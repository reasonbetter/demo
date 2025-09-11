export const runtime = 'edge';
 import { AJ_SYSTEM } from "../../../lib/prompts/aj.system.js"
export async function POST(req) {
  try {
    const { item, userResponse, features } = await req.json();

    if (!item?.text || typeof userResponse !== "string") {
      return new Response(JSON.stringify({ error: "Bad request" }), { status: 400 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), { status: 500 });
    }

 import { AJ_SYSTEM } from "../../../lib/prompts/aj.system.js"
    
    const r = await fetch("https://api.openai.com/v1/responses", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: process.env.OPENAI_MODEL || "gpt-5-mini",
    response_format: { type: "json_object" },
    max_output_tokens: 300, // Responses API uses max_output_tokens
    input: [
      { role: "system", content: AJ_SYSTEM },
      { role: "user", content: JSON.stringify({ stimulus: item.text, user_response: userResponse, features: features || {} }) }
    ]
  })
});
const data = await r.json();
const text = data?.output_text || ""; // Responses API convenience field


    if (!r.ok) {
      const errText = await r.text();
      return new Response(JSON.stringify({ error: "OpenAI call failed", details: errText.slice(0, 800) }), { status: 502 });
    }

    let payload;
    try { payload = JSON.parse(text); }
    catch {
      return new Response(JSON.stringify({ error: "Model returned non-JSON", sample: text.slice(0, 800) }), { status: 502 });
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "AJ route error", details: String(err) }), { status: 500 });
  }
}

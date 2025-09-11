// app/api/aj/route.js
export const runtime = 'edge';
// optional (helps Vercel choose region close to you)
// export const preferredRegion = 'iad1';

import { AJ_SYSTEM } from "../../../lib/prompts/aj.system.js"; // adjust if your file lives elsewhere

export async function GET() {
  // Helpful while debugging: confirms route is alive
  return new Response(JSON.stringify({ ok: true, method: 'GET' }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { item, userResponse, features } = body || {};

    if (!item?.text || typeof userResponse !== "string") {
      return new Response(JSON.stringify({ error: "Bad request: missing item.text or userResponse" }), { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), { status: 500 });
    }

    // Edge runtime => use fetch to OpenAI REST endpoint
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: AJ_SYSTEM },
          { role: "user", content: JSON.stringify({
              stimulus: item.text,
              user_response: userResponse,
              features: features || {}
            })
          }
        ],
        // keep outputs tight for latency
        max_tokens: 300
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      return new Response(JSON.stringify({ error: "OpenAI call failed", details: errText.slice(0, 800) }), { status: 502 });
    }

    const json = await r.json();
    const text = json?.choices?.[0]?.message?.content || "";
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
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

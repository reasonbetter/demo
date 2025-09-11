// app/api/aj/route.js
export const runtime = 'edge';

import { AJ_SYSTEM } from "../../../lib/prompts/aj.system.js";

export async function POST(req) {
  try {
    const { item, userResponse, features } = await req.json();
    if (!item?.text || typeof userResponse !== "string") {
      return new Response(JSON.stringify({ error: "Bad request: missing item.text or userResponse" }), { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), { status: 500 });
    }

    // Edge runtime ⇒ use the REST fetch form
    const body = {
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: AJ_SYSTEM },
        { role: "user", content: JSON.stringify({ stimulus: item.text, user_response: userResponse, features: features || {} }) }
      ]
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
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

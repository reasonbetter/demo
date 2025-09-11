// app/api/aj/route.js
export const runtime = 'edge';
// export const preferredRegion = 'iad1'; // optional

export async function GET() {
  return new Response(JSON.stringify({ ok: true, method: 'GET' }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

export async function POST(req) {
  try {
    const { item, userResponse, features } = await req.json();

    if (!item?.text || typeof userResponse !== "string") {
      return new Response(JSON.stringify({ error: "Bad request" }), { status: 400 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), { status: 500 });
    }

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5-mini",
        response_format: { type: "json_object" },
        max_tokens: 300,
        messages: [
          { role: "system", content: /* import your AJ_SYSTEM string here */ "..." },
          { role: "user", content: JSON.stringify({ stimulus: item.text, user_response: userResponse, features: features || {} }) }
        ]
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      return new Response(JSON.stringify({ error: "OpenAI call failed", details: errText.slice(0,800) }), { status: 502 });
    }

    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content || "";
    let payload;
    try { payload = JSON.parse(text); }
    catch { return new Response(JSON.stringify({ error: "Model returned non-JSON", sample: text.slice(0,800) }), { status: 502 }); }

    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" }});
  } catch (err) {
    return new Response(JSON.stringify({ error: "AJ route error", details: String(err) }), { status: 500 });
  }
}

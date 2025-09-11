// app/api/aj/route.js
export const runtime = 'edge';

import { AJ_SYSTEM } from '../../../lib/prompts/aj.system.js

export async function POST(req) {
  try {
    const { item, userResponse, features } = await req.json();

    if (!item?.text || typeof userResponse !== 'string') {
      return new Response(JSON.stringify({ error: 'Bad request' }), { status: 400 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: 'Missing OPENAI_API_KEY' }), { status: 500 });
    }

    const model = process.env.OPENAI_MODEL || 'gpt-5-mini';

    // Responses API expects content arrays with typed blocks
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        text: { format: 'json' },       // <-- replaces old response_format
        max_output_tokens: 300,         // <-- correct key for Responses API
        input: [
          {
            role: 'system',
            content: [
              { type: 'text', text: AJ_SYSTEM }   // <-- content array, not a string
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
    if (!r.ok) {
      return new Response(
        JSON.stringify({
          error: 'OpenAI call failed',
          details: JSON.stringify(data).slice(0, 800)
        }),
        { status: 502 }
      );
    }

    // Prefer convenience field; fall back to structured content
    const text =
      data?.output_text ??
      data?.output?.[0]?.content?.[0]?.text ??
      '';

    if (!text) {
      return new Response(
        JSON.stringify({
          error: 'Model returned empty output_text',
          sample: JSON.stringify(data).slice(0, 800)
        }),
        { status: 502 }
      );
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Model returned non-JSON', sample: text.slice(0, 800) }),
        { status: 502 }
      );
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'AJ route error', details: String(err) }), { status: 500 });
  }
}

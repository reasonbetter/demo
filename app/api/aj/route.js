// Alternative Edge route using Chat Completions (stable)
export const runtime = 'edge';
import AJ_SYSTEM from '../../../lib/prompts/aj.system.js';

export async function POST(req) {
  const { item, userResponse, features } = await req.json();
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5-mini',
      // IMPORTANT: omit temperature if your model doesn't accept overrides
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: AJ_SYSTEM },
        { role: 'user', content: JSON.stringify({ stimulus: item.text, user_response: userResponse, features: features || {} }) }
      ],
      max_completion_tokens: 300
    })
  });
  const data = await r.json();
  if (!r.ok) {
    return new Response(JSON.stringify({ error: 'OpenAI call failed', details: JSON.stringify(data).slice(0,800)}), { status: 502 });
  }
  const text = data?.choices?.[0]?.message?.content || '';
  let payload;
  try { payload = JSON.parse(text); }
  catch { return new Response(JSON.stringify({ error:'Model returned non-JSON', sample: text.slice(0, 800) }), { status: 502 }); }
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' }});
}

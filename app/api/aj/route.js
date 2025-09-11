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
  // Minimal echo to prove POST works
  const bodyText = await req.text().catch(() => "");
  return new Response(JSON.stringify({ ok: true, method: 'POST', len: bodyText.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

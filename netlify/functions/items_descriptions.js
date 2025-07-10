import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const dataKey = 'items_descriptions.json';

export default async (request, context) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (request.method === 'OPTIONS') { return new Response(null, { headers }); }
  try {
    if (request.method === 'GET') { const data = await redis.get(dataKey); return new Response(JSON.stringify(data || []), { status: 200, headers }); }
    if (request.method === 'POST') { const body = await request.json(); await redis.set(dataKey, body); return new Response(JSON.stringify({ message: 'Saved successfully.' }), { status: 200, headers }); }
  } catch (error) { return new Response(JSON.stringify({ error: error.message }), { status: 500, headers }); }
};

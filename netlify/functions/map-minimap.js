import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const minimapDataKey = 'system_minimap_image_v2';

export default async (request, context) => {
  const headers = { 
    'Access-Control-Allow-Origin': '*', 
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 
    'Access-Control-Allow-Headers': 'Content-Type' 
  };

  if (request.method === 'OPTIONS') { 
    return new Response(null, { headers }); 
  }

  try {
    if (request.method === 'GET') {
      const data = await redis.get(minimapDataKey);
      // Return the data URL string directly, or an empty string if it doesn't exist
      return new Response(data || '', { status: 200, headers: { ...headers, 'Content-Type': 'text/plain' } });
    }

    if (request.method === 'POST') {
      const body = await request.text(); // The data URL is sent as plain text
      await redis.set(minimapDataKey, body);
      return new Response(JSON.stringify({ message: 'Minimap saved successfully.' }), { status: 200, headers });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};

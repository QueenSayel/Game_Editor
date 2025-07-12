import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

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
      const url = new URL(request.url);
      const coord = url.searchParams.get('coord');
      if (!coord) {
        return new Response(JSON.stringify({ error: 'Coordinate parameter "coord" is required.' }), { status: 400, headers });
      }
      const data = await redis.get(coord);
      // Return the data, or null if it doesn't exist. The client will handle generation.
      return new Response(JSON.stringify(data), { status: 200, headers });
    }

    if (request.method === 'POST') {
      const { coord, data } = await request.json();
      if (!coord || !data) {
        return new Response(JSON.stringify({ error: 'Request body must include "coord" and "data".' }), { status: 400, headers });
      }
      await redis.set(coord, data);
      return new Response(JSON.stringify({ message: 'Chunk saved successfully.' }), { status: 200, headers });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};

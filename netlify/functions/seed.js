import { Redis } from '@upstash/redis';
import { readdir, readFile } from 'fs/promises';
import path from 'path';

const SUPER_SECRET_KEY = 'anemoia123';

export default async (request, context) => {
  const headers = { 'Content-Type': 'application/json' };
  const url = new URL(request.url);
  const key = url.searchParams.get('key');

  if (key !== SUPER_SECRET_KEY) {
    return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401, headers });
  }

  try {
    const redis = Redis.fromEnv();
    // This assumes your JSON data files are in a 'data' folder in the root
    const dataDir = path.join(process.cwd(), 'data');
    const files = await readdir(dataDir);
    const jsonFiles = files.filter(file => file.endsWith('.json'));

    const results = [];
    for (const file of jsonFiles) {
      const filePath = path.join(dataDir, file);
      const fileContent = await readFile(filePath, 'utf-8');
      const jsonData = JSON.parse(fileContent);
      await redis.set(file, jsonData);
      results.push({ file: file, status: 'Seeded' });
    }

    return new Response(JSON.stringify({ message: 'Seeding complete!', results }), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};

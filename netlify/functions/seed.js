import { Redis } from '@upstash/redis';
import { readdir, readFile } from 'fs/promises';
import path from 'path';

// MAKE SURE THIS MATCHES THE KEY YOU USE IN THE URL
const SUPER_SECRET_KEY = 'anemoia123'; 

export default async (request, context) => {
  const headers = { 'Content-Type': 'application/json' };
  const url = new URL(request.url);
  const key = url.searchParams.get('key');

  if (key !== SUPER_SECRET_KEY) {
    return new Response(JSON.stringify({ message: 'Unauthorized. Invalid key.' }), { status: 401, headers });
  }

  const redis = Redis.fromEnv();
  const results = [];
  let currentFile = 'N/A';

  try {
    const dataDir = path.join(process.cwd(), 'data');
    const files = await readdir(dataDir);
    const jsonFiles = files.filter(file => file.endsWith('.json'));

    if (jsonFiles.length === 0) {
      return new Response(JSON.stringify({ message: 'No JSON files found in /data directory.' }), { status: 404, headers });
    }

    for (const file of jsonFiles) {
      currentFile = file;
      const filePath = path.join(dataDir, file);
      let fileContent = await readFile(filePath, 'utf-8');
      
      // --- THIS IS THE FIX ---
      // Check if the first character is a BOM and remove it if it exists.
      if (fileContent.charCodeAt(0) === 0xFEFF) {
        fileContent = fileContent.slice(1);
      }
      
      if (fileContent.trim() === '') {
        results.push({ file: file, status: '⚠️ Skipped (empty file)' });
        continue;
      }

      const jsonData = JSON.parse(fileContent);
      await redis.set(file, jsonData);
      results.push({ file: file, status: '✅ Seeded' });
    }

    return new Response(JSON.stringify({ message: 'Seeding complete!', results }), { status: 200, headers });

  } catch (error) {
    const errorMessage = `Failed to process file: ${currentFile}. Error: ${error.message}`;
    return new Response(JSON.stringify({ error: errorMessage, stack: error.stack }), { status: 500, headers });
  }
};

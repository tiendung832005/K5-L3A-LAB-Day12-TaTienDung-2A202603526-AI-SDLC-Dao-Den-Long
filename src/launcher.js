import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { normalizeName, PLAYER_NAME } from './shared/leaderboard.js';

const root = new URL('../', import.meta.url);
const leaderboardPath = () => resolve('data/leaderboard.json');
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json' };
const MAX_BODY = 4096;

async function readEntries(file) {
  try {
    const { entries } = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(entries)) throw new Error('Invalid leaderboard file: expected entries array');
    return entries;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function topTen(entries) {
  return { entries: [...entries].sort((a, b) => b.score - a.score || Date.parse(a.achieved_at) - Date.parse(b.achieved_at)).slice(0, 10) };
}

function send(response, status, data, type = 'application/json') {
  response.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let bytes = 0;
    request.on('data', chunk => {
      bytes += chunk.length;
      if (bytes <= MAX_BODY) chunks.push(chunk);
    });
    request.on('error', reject);
    request.on('aborted', () => reject(Object.assign(new Error('Request aborted'), { status: 400 })));
    request.on('end', () => {
      if (bytes > MAX_BODY) return reject(Object.assign(new Error('Request body exceeds 4096 bytes'), { status: 413 }));
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
  });
}

function resultEntry(body) {
  const name = normalizeName(body?.name);
  const { score, nights_won, seed } = body ?? {};
  if (!PLAYER_NAME.test(name) || !Number.isSafeInteger(score) || score < 0 ||
      !Number.isInteger(nights_won) || nights_won < 0 || nights_won > 3 || !Number.isSafeInteger(seed)) {
    return null;
  }
  return { name, score, nights_won, achieved_at: new Date().toISOString(), seed };
}

export async function startServer({ port = 3000, file = leaderboardPath() } = {}) {
  let pendingWrite = Promise.resolve();
  function save(entry) {
    const writing = pendingWrite.then(async () => {
      const entries = await readEntries(file);
      entries.push(entry);
      const directory = dirname(file);
      await mkdir(directory, { recursive: true });
      const temporary = join(directory, `.leaderboard-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, `${JSON.stringify({ entries }, null, 2)}\n`, { flag: 'wx' });
        await rename(temporary, file);
      } finally {
        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
    });
    pendingWrite = writing.catch(() => {});
    return writing;
  }

  const server = createServer(async (request, response) => {
    try {
      const { pathname } = new URL(request.url, 'http://localhost');
      if (pathname === '/api/leaderboard') {
        if (request.method === 'GET') return send(response, 200, topTen(await readEntries(file)));
        if (request.method !== 'POST') return send(response, 405, { error: 'Method not allowed' });
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
          request.resume();
          return send(response, 415, { error: 'Expected application/json' });
        }
        const entry = resultEntry(await readBody(request));
        if (!entry) return send(response, 400, { error: 'Invalid leaderboard entry' });
        await save(entry);
        return send(response, 201, { entry });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, { error: 'Method not allowed' });
      const asset = pathname === '/' ? '/index.html' : pathname;
      if (!['/index.html', '/game.contract.json'].includes(asset) && !/^\/src\/(client|sim|shared)\/[\w-]+\.(js|css)$/.test(asset)) {
        return send(response, 404, { error: 'Not found' });
      }
      const content = await readFile(new URL(asset.slice(1), root));
      send(response, 200, request.method === 'HEAD' ? '' : content, types[asset.split('.').at(-1)]);
    } catch (error) {
      if (response.destroyed) return;
      const status = error.status ?? (error.code === 'ENOENT' ? 404 : 500);
      send(response, status, { error: status === 500 ? 'Internal server error' : error.message });
    }
  });
  const listening = once(server, 'listening');
  server.listen(port, '127.0.0.1');
  await listening;
  return server;
}

async function main() {
  const { values } = parseArgs({ options: { 'export-leaderboard': { type: 'string' } } });
  if (values['export-leaderboard'] !== undefined) {
    if (!values['export-leaderboard']) throw new Error('Missing leaderboard export path');
    const target = resolve(values['export-leaderboard']);
    const results = topTen(await readEntries(leaderboardPath()));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(results, null, 2)}\n`);
    return;
  }
  const server = await startServer();
  console.log(`Đảo Đèn Lồng: http://localhost:${server.address().port}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

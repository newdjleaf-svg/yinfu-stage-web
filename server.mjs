import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('./dist/', import.meta.url)));
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};
const port = Number(process.env.PORT || 3000);
createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400).end(); return; }
  const path = resolve(root, '.' + pathname, pathname.endsWith('/') ? 'index.html' : '');
  if (path !== root && !path.startsWith(root + sep)) {
    response.writeHead(403).end(); return;
  }
  try {
    if (!(await stat(path)).isFile()) throw new Error('Not a file');
    const body = await readFile(path);
    response.writeHead(200, {
      'Content-Type': types[extname(path)] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': pathname === '/sw.js' || pathname === '/' ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found'); }
}).listen(port, '0.0.0.0', () => console.log(`音芙場控網頁版已啟動：${port}`));

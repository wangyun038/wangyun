import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import game from './dist/game.mjs';

const port = Number(process.env.PORT ?? 10000);
const origin = new URL(process.env.RENDER_EXTERNAL_URL ?? 'http://127.0.0.1:' + port).origin;
const db = new DatabaseSync(process.env.DATABASE_PATH ?? ':memory:');
if (!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rooms'").get()) {
  db.exec(readFileSync(new URL('./rooms.sql', import.meta.url), 'utf8'));
}
const env = { DB: { prepare: query => ({ bind: (...args) => ({
  first: () => db.prepare(query).get(...args),
  run: () => ({ meta: { changes: Number(db.prepare(query).run(...args).changes) } })
}) }) } };

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.origin !== origin) return res.writeHead(400).end();
    if (url.pathname === '/healthz') return res.writeHead(200).end('ok');
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 16384) return res.writeHead(413).end();
      chunks.push(chunk);
    }
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      ...(length && !['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {})
    });
    const response = await game.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error.message);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
server.listen(port, '0.0.0.0', () => console.log('Listening on port ' + port));

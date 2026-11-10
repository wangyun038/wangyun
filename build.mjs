import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('index.html').replace('<!-- CLIENT_SCRIPT -->', () => read('client.js'));
mkdirSync(new URL('dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('dist/game.mjs', import.meta.url), 'const page = ' + JSON.stringify(page) + ';\n' + read('worker.mjs'));

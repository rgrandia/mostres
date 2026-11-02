// Test de la contrasenya d'accés: node tests/middleware.test.mjs <contrasenya>
// (la contrasenya no és al repositori en clar; passa-la com a argument)
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const pw = process.argv[2];
if (!pw) { console.error('Ús: node tests/middleware.test.mjs <contrasenya>'); process.exit(1); }
const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'middleware.js');
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mw-')), 'mw.mjs');
fs.copyFileSync(src, tmp);
const { default: mw } = await import(pathToFileURL(tmp));
const base = 'https://mostres.example';
const post = (p) => new Request(base + '/entrar', { method: 'POST', body: new URLSearchParams({ password: p }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

assert.strictEqual((await mw(new Request(base + '/'))).status, 401);
assert.strictEqual((await mw(new Request(base + '/data/cens-base.js'))).status, 401);
assert.strictEqual((await mw(post(pw + 'x'))).status, 401);
const ok = await mw(post(pw));
assert.strictEqual(ok.status, 303);
const cookie = ok.headers.get('set-cookie').split(';')[0];
assert.strictEqual((await mw(new Request(base + '/data/cens-base.js', { headers: { cookie } }))).headers.get('x-middleware-next'), '1');
assert.strictEqual((await mw(new Request(base + '/', { headers: { cookie: 'mostres_sessio=fals' } }))).status, 401);
assert.match((await mw(new Request(base + '/sortir'))).headers.get('set-cookie'), /Max-Age=0/);
console.log('ok - contrasenya d\'accés');

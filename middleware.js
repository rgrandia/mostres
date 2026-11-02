/*
 * Contrasenya d'accés (Routing Middleware de Vercel).
 *
 * S'executa al servidor abans de servir qualsevol fitxer: sense la galeta de
 * sessió, ni la pàgina ni les dades (data/cens-base.js) arriben al navegador.
 * La contrasenya no és al codi en clar, només el seu hash SHA-256. Es pot
 * canviar sense tocar el codi definint la variable d'entorn APP_PASSWORD al
 * projecte de Vercel (Settings → Environment Variables), que té prioritat.
 */
export const config = {
  // el logotip de la pantalla d'entrada es pot servir sense sessió
  matcher: '/((?!img/).*)',
};

// SHA-256 de la contrasenya per defecte
const PASSWORD_SHA256 = 'd8c49c2b500481d5cf1490c80efab85f8bca5c308af431e6fe69824c61f50004';
const COOKIE = 'mostres_sessio';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 dies

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function expectedHash() {
  const env = typeof process !== 'undefined' && process.env ? process.env.APP_PASSWORD : '';
  return env ? sha256(env) : PASSWORD_SHA256;
}

/** Comparació de longitud fixa, perquè el temps de resposta no doni pistes. */
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  const hit = raw.split(/;\s*/).find((c) => c.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
}

// deixa passar la petició cap al fitxer estàtic
const pass = () => new Response(null, { headers: { 'x-middleware-next': '1' } });

export default async function middleware(request) {
  const url = new URL(request.url);
  const pwHash = await expectedHash();
  const token = await sha256(pwHash + ':mostres');

  if (url.pathname === '/sortir') {
    return new Response(null, {
      status: 303,
      headers: { location: '/', 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, 'cache-control': 'no-store' },
    });
  }

  if (url.pathname === '/entrar' && request.method === 'POST') {
    let pw = '';
    try { pw = String((await request.formData()).get('password') || ''); } catch (e) { /* formulari buit */ }
    if (same(await sha256(pw), pwHash)) {
      return new Response(null, {
        status: 303,
        headers: { location: '/', 'set-cookie': `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`, 'cache-control': 'no-store' },
      });
    }
    return login(true);
  }

  if (same(readCookie(request, COOKIE), token)) return pass();
  return login(false);
}

function login(error) {
  const html = `<!doctype html>
<html lang="ca"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Generador de mostres · Accés</title>
<meta name="robots" content="noindex">
<link rel="icon" type="image/png" href="/img/gesop-simbol-blau.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;700&display=swap">
<style>
:root { color-scheme: light; --blau: #0071bc; --blau-fosc: #00548c; --blau-fons: #d4e5f6; --gris-fosc: #63666a; --gris-2: #bbbcbc; --groc-25: #ffefbf; --groc: #ffc000; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--blau); font: 400 14px/1.5 "Montserrat", Arial, sans-serif; color: var(--gris-fosc); padding: 16px; }
main { background: #fff; width: min(380px, 100%); padding: 32px 28px 28px; display: flex; flex-direction: column; gap: 18px; }
img { height: 30px; width: auto; align-self: flex-start; }
h1 { margin: 0; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--blau); }
label { display: flex; flex-direction: column; gap: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
input { font: inherit; font-size: 15px; padding: 9px 10px; border: 1px solid var(--gris-2); color: #000; }
input:focus { outline: 2px solid var(--blau); outline-offset: 1px; border-color: var(--blau); }
button { font: inherit; font-weight: 700; background: var(--blau); color: #fff; border: 0; padding: 10px 16px; cursor: pointer; }
button:hover { background: var(--blau-fosc); }
.err { margin: 0; padding: 8px 12px; background: var(--groc-25); border-left: 4px solid var(--groc); color: #000; font-size: 13px; }
</style></head>
<body><main>
<img src="/img/gesop-logotip-blau.png" alt="GESOP" width="137" height="30">
<h1>Generador de mostres</h1>
${error ? '<p class="err" role="alert">La contrasenya no és correcta.</p>' : ''}
<form method="post" action="/entrar">
  <label>Contrasenya<input type="password" name="password" autocomplete="current-password" required autofocus></label>
  <p style="margin:14px 0 0"><button type="submit">Entra</button></p>
</form>
</main></body></html>`;
  return new Response(html, {
    status: 401,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}

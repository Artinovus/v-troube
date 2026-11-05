// POUZE PRO TESTY: minimální napodobenina Supabase Auth (GoTrue) API.
// Ověřuje e-mail a heslo proti tabulce auth.users v lokální testovací DB.
import http from 'node:http';
import crypto from 'node:crypto';
import postgres from 'postgres';

const PORT = Number(process.env.MOCK_AUTH_PORT ?? 54321);
const SECRET = 'test-only-secret';
const sql = postgres(process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/ztrouby_test', { max: 2 });
const refresh = new Map();
const revoked = new Set();

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(payload) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  const sig = crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verify(token) {
  const [h, b, s] = (token ?? '').split('.');
  if (!h || !b || !s) return null;
  const exp = crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url');
  if (exp !== s || revoked.has(token)) return null;
  const p = JSON.parse(Buffer.from(b, 'base64url').toString());
  if (p.exp * 1000 < Date.now()) return null;
  return p;
}
const userObj = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() });
function session(u) {
  const now = Math.floor(Date.now() / 1000);
  const access_token = sign({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600, session_id: crypto.randomUUID() });
  const refresh_token = crypto.randomBytes(16).toString('hex');
  refresh.set(refresh_token, u);
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token, user: userObj(u) };
}
const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
  res.end(body == null ? '' : JSON.stringify(body));
};

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, 'http://x');
  let raw = '';
  for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  try {
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const [u] = await sql`select id, email from auth.users where lower(email) = lower(${body.email ?? ''}) and test_password = ${body.password ?? ''}`;
      if (!u) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return send(res, 200, session(u));
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const u = refresh.get(body.refresh_token);
      if (!u) return send(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      refresh.delete(body.refresh_token);
      return send(res, 200, session(u));
    }
    if (url.pathname === '/auth/v1/user') {
      const token = (req.headers.authorization ?? '').replace(/^Bearer /i, '');
      const p = verify(token);
      if (!p) return send(res, 403, { code: 403, error_code: 'bad_jwt', msg: 'invalid JWT' });
      return send(res, 200, userObj({ id: p.sub, email: p.email }));
    }
    if (url.pathname === '/auth/v1/logout') {
      const token = (req.headers.authorization ?? '').replace(/^Bearer /i, '');
      revoked.add(token);
      return send(res, 204);
    }
    return send(res, 404, { msg: 'not found' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { msg: 'error' });
  }
}).listen(PORT, () => console.log(`mock auth on :${PORT}`));

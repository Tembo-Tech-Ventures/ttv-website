import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getCookies } from 'better-auth/cookies';
import { DEMO_CUTOFF, DEMO_ORIGIN, DEMO_PERSONAS, DEMO_PREFIX, DEMO_SESSION_MARKER, demoEnabled, demoPersona, isDemoUser } from './staging-demo-policy';

export const DEMO_OPERATOR_COOKIE = '__Host-ttv-demo-operator';
export class DemoAccessError extends Error {
  constructor(public status = 403) { super('Demo access is unavailable or expired.'); }
}
export interface DemoEnvironment {
  DB: D1Database; BETTER_AUTH_SECRET: string; DEPLOYMENT_ENVIRONMENT?: string; STAGING_DEMO_ENABLED?: string;
}
interface SessionRow { id: string; userId: string; userAgent: string | null; createdAt: number; expiresAt: number }
function signature(value: string, secret: string) { return createHmac('sha256', secret).update(value).digest('base64'); }
function readCookie(request: Request, name: string) {
  const raw = request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1);
  try { return raw ? decodeURIComponent(raw) : null; } catch { return null; }
}
function verifiedToken(value: string | null, secret: string) {
  if (!value || value.length > 512 || secret.length < 32) return null;
  const at = value.lastIndexOf('.');
  if (at < 1) return null;
  const token = value.slice(0, at), actual = Buffer.from(value.slice(at + 1)), expected = Buffer.from(signature(token, secret));
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? token : null;
}
const cookies = getCookies({ baseURL: DEMO_ORIGIN });
function cookie(name: string, value: string, expiresAt: number) {
  return name + '=' + encodeURIComponent(value) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=' + new Date(expiresAt * 1000).toUTCString();
}
function requireEnabled(env: DemoEnvironment, request: Request, now: number) {
  if (!demoEnabled(env.DEPLOYMENT_ENVIRONMENT, env.STAGING_DEMO_ENABLED, new URL(request.url).origin, now)) throw new DemoAccessError(404);
}
async function liveAdmin(db: D1Database, id: string, now: number) {
  return db.prepare(`SELECT s.id,s.userId,s.userAgent,s.createdAt,s.expiresAt FROM session s
    WHERE s.id=? AND s.expiresAt>? AND (s.userAgent IS NULL OR s.userAgent NOT LIKE 'ttv-agent:%')
    AND EXISTS (SELECT 1 FROM UserRoles ur JOIN Roles r ON r.id=ur.roleId WHERE ur.userId=s.userId AND r.name='ADMIN')`).bind(id, now).first<SessionRow>();
}
export async function demoOperator(env: DemoEnvironment, request: Request, now = Math.floor(Date.now() / 1000)) {
  requireEnabled(env, request, now);
  if (request.headers.has('authorization')) throw new DemoAccessError();
  const value = readCookie(request, DEMO_OPERATOR_COOKIE) ?? readCookie(request, cookies.sessionToken.name);
  const token = verifiedToken(value, env.BETTER_AUTH_SECRET);
  if (!token) throw new DemoAccessError(401);
  const source = await env.DB.prepare('SELECT id FROM session WHERE token=?').bind(token).first<{id:string}>();
  const admin = source && await liveAdmin(env.DB, source.id, now);
  if (!admin || admin.userId.startsWith('ttv-')) throw new DemoAccessError(401);
  return { session: admin, cookieValue: value!, expiresAt: Math.min(admin.expiresAt, DEMO_CUTOFF) };
}
/** Rechecks the actual session and its still-live admin parent, bypassing cookie cache. */
export async function validateDemoSession(env: DemoEnvironment, request: Request, user: {id:string;email:string}, session: {id:string;userAgent?:string|null}, now = Math.floor(Date.now() / 1000)) {
  if (!user.id.startsWith(DEMO_PREFIX) && !session.userAgent?.startsWith(DEMO_SESSION_MARKER)) return null;
  requireEnabled(env, request, now);
  if (request.headers.has('authorization') || !isDemoUser(user.id) || user.email !== user.id + '@invalid.ttv') throw new DemoAccessError();
  const row = await env.DB.prepare('SELECT id,userId,userAgent,createdAt,expiresAt FROM session WHERE id=? AND userId=?').bind(session.id,user.id).first<SessionRow>();
  const persona = Object.entries(DEMO_PERSONAS).find(([,p]) => p.userId === user.id)?.[0];
  if (!row || !persona || !row.userAgent?.startsWith(DEMO_SESSION_MARKER) || row.userAgent !== session.userAgent || row.createdAt > now || row.expiresAt <= now || row.expiresAt > row.createdAt + 3600 || row.expiresAt > DEMO_CUTOFF) throw new DemoAccessError();
  const parent = await liveAdmin(env.DB, row.userAgent.slice(DEMO_SESSION_MARKER.length), now);
  if (!parent) throw new DemoAccessError();
  return { persona, expiresAt: Math.min(row.expiresAt, parent.expiresAt, DEMO_CUTOFF) };
}
async function readSwitchBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new DemoAccessError();
  const decoder = new TextDecoder();
  let text = "", size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 256) { await reader.cancel(); throw new DemoAccessError(); }
      text += decoder.decode(chunk.value, {stream:true});
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}
export async function handleDemoAction(env: DemoEnvironment, request: Request, action: string, now = Math.floor(Date.now() / 1000)): Promise<Response> {
  try {
    requireEnabled(env, request, now);
    if (request.method !== 'POST' || request.headers.get('origin') !== DEMO_ORIGIN) throw new DemoAccessError();
    const operator = await demoOperator(env, request, now);
    const headers = new Headers({'Cache-Control':'no-store','Content-Type':'application/json'});
    const marker = DEMO_SESSION_MARKER + operator.session.id;
    if (action === 'logout') {
      // Full logout revokes the source browser session and all demo sessions it controls.
      await env.DB.batch([
        env.DB.prepare('DELETE FROM session WHERE userAgent=?').bind(marker),
        env.DB.prepare('DELETE FROM session WHERE id=?').bind(operator.session.id),
      ]);
      for (const name of [DEMO_OPERATOR_COOKIE, ...Object.values(cookies).map(c=>c.name)]) headers.append('Set-Cookie',cookie(name,'',0));
      return new Response(JSON.stringify({redirectTo:'/demo'}),{headers});
    }
    if (action !== 'switch') throw new DemoAccessError(404);
    if (Number(request.headers.get('content-length') ?? 0) > 256) throw new DemoAccessError();
    const body = await readSwitchBody(request);
    const persona = demoPersona(body?.persona);
    if (!persona || Object.keys(body).length !== 1) throw new DemoAccessError();
    const chosen = DEMO_PERSONAS[persona];
    const user = await env.DB.prepare('SELECT id,email FROM user WHERE id=?').bind(chosen.userId).first<{id:string;email:string}>();
    if (!user || user.email !== chosen.userId + '@invalid.ttv') throw new DemoAccessError(409);
    const {results:roles} = await env.DB.prepare('SELECT r.name FROM Roles r JOIN UserRoles ur ON ur.roleId=r.id WHERE ur.userId=?').bind(chosen.userId).all<{name:string}>();
    if (roles.some(r=>r.name !== chosen.role) || (chosen.role && !roles.some(r=>r.name===chosen.role))) throw new DemoAccessError(409);
    const token = randomBytes(32).toString('hex'), id = crypto.randomUUID();
    const expiry = Math.min(now + 3600, operator.expiresAt);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM session WHERE userAgent=?').bind(marker),
      env.DB.prepare('INSERT INTO session (id,userId,token,userAgent,createdAt,updatedAt,expiresAt) VALUES (?,?,?,?,?,?,?)').bind(id,chosen.userId,token,marker,now,now,expiry),
    ]);
    headers.append('Set-Cookie',cookie(DEMO_OPERATOR_COOKIE,operator.cookieValue,operator.expiresAt));
    headers.append('Set-Cookie',cookie(cookies.sessionToken.name,token + '.' + signature(token,env.BETTER_AUTH_SECRET),expiry));
    headers.append('Set-Cookie',cookie(cookies.dontRememberToken.name,'true.' + signature('true',env.BETTER_AUTH_SECRET),expiry));
    headers.append('Set-Cookie',cookie(cookies.sessionData.name,'',0));
    return new Response(JSON.stringify({redirectTo:chosen.redirectTo}),{headers});
  } catch (error) {
    return demoErrorResponse(error, request, action);
  }
}

function demoErrorResponse(error: unknown, request: Request, action: string) {
    const headers = new Headers({'Content-Type':'application/json','Cache-Control':'no-store'});
    if (action === 'logout' && request.method === 'POST' && request.headers.get('origin') === DEMO_ORIGIN && new URL(request.url).origin === DEMO_ORIGIN) {
      for (const name of [DEMO_OPERATOR_COOKIE, ...Object.values(cookies).map(c=>c.name)]) headers.append('Set-Cookie',cookie(name,'',0));
    }
    return new Response(JSON.stringify({error:'Demo access is unavailable or expired.'}), {status:error instanceof DemoAccessError?error.status:403,headers});
}

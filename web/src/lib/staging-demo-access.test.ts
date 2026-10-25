import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { getCookies } from 'better-auth/cookies';
import { handleDemoAction, validateDemoSession, DEMO_OPERATOR_COOKIE } from './staging-demo-access';
import { DEMO_PERSONAS, DEMO_ORIGIN, DEMO_SESSION_MARKER, DEMO_CUTOFF, demoPathAllowed } from './staging-demo-policy';
const databases: DatabaseSync[]=[];
afterEach(()=>databases.splice(0).forEach(db=>db.close()));
const now=Date.parse('2026-10-25T07:00:00Z')/1000;
const secret='unit-test-only-secret-never-used-outside-tests';
const cookieName=getCookies({baseURL:DEMO_ORIGIN}).sessionToken.name;
const signed=(token:string)=>encodeURIComponent(token+'.'+createHmac('sha256',secret).update(token).digest('base64'));
function setup() {
  const sql=new DatabaseSync(':memory:');databases.push(sql);
  sql.exec(`CREATE TABLE user(id TEXT PRIMARY KEY,email TEXT);CREATE TABLE session(id TEXT PRIMARY KEY,userId TEXT,token TEXT,userAgent TEXT,createdAt INTEGER,updatedAt INTEGER,expiresAt INTEGER);
    CREATE TABLE Roles(id TEXT PRIMARY KEY,name TEXT);CREATE TABLE UserRoles(id TEXT PRIMARY KEY,userId TEXT,roleId TEXT);
    INSERT INTO Roles VALUES ('admin','ADMIN'),('mentor','MENTOR'),('institution','INSTITUTION'),('student','STUDENT');
    INSERT INTO user VALUES('raph','raph@example.invalid');INSERT INTO UserRoles VALUES('a','raph','admin');`);
  sql.prepare('INSERT INTO session VALUES(?,?,?,?,?,?,?)').run('parent','raph','unit-parent-token','Browser',now,now,DEMO_CUTOFF);
  for (const p of Object.values(DEMO_PERSONAS)) {
    sql.prepare('INSERT INTO user VALUES(?,?)').run(p.userId,p.userId+'@invalid.ttv');
    if(p.role) sql.prepare('INSERT INTO UserRoles VALUES(?,?,?)').run(p.userId,p.userId,p.role.toLowerCase());
  }
  const db={prepare(query:string) {
    let params:unknown[]=[];
    const stmt={bind(...values:unknown[]){params=values;return stmt;},async first(){return sql.prepare(query).get(...params as never[])??null;},async all(){return {results:sql.prepare(query).all(...params as never[])};},async run(){return {meta:{changes:sql.prepare(query).run(...params as never[]).changes}};}};return stmt;
  },async batch(statements:{run:()=>Promise<unknown>}[]) { sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;} }} as unknown as D1Database;
  const env={DB:db,BETTER_AUTH_SECRET:secret,DEPLOYMENT_ENVIRONMENT:'staging',STAGING_DEMO_ENABLED:'true'};
  const request=(persona='mentor',extra:Record<string,string>={})=>new Request(DEMO_ORIGIN+'/api/demo/switch',{method:'POST',headers:{origin:DEMO_ORIGIN,cookie:cookieName+'='+signed('unit-parent-token'),...extra},body:JSON.stringify({persona})});
  return {sql,env,request};
}
describe('retained demo browser boundary',()=>{
  it('switches only fixed personas, revokes the previous session, and uses secure cookies',async()=>{
    const f=setup();const response=await handleDemoAction(f.env,f.request(),'switch',now);
    expect(response.status).toBe(200);expect(await response.json()).toEqual({redirectTo:'/dashboard/mentorship'});
    const set=response.headers.getSetCookie();expect(set).toHaveLength(4);
    for(const value of set)expect(value).toContain('HttpOnly; Secure; SameSite=Lax');
    const first=f.sql.prepare('SELECT * FROM session WHERE userAgent=?').get(DEMO_SESSION_MARKER+'parent')!;
    expect(first.expiresAt).toBe(now+3600);
    await handleDemoAction(f.env,f.request('institution'),'switch',now+1);
    expect(f.sql.prepare('SELECT id FROM session WHERE id=?').get(first.id as string)).toBeUndefined();
    expect(f.sql.prepare('SELECT count(*) n FROM session WHERE userAgent=?').get(DEMO_SESSION_MARKER+'parent')?.n).toBe(1);
  });
  it('revalidates source revocation despite cached persona identity',async()=>{
    const f=setup();await handleDemoAction(f.env,f.request(),'switch',now);
    const row=f.sql.prepare('SELECT * FROM session WHERE userAgent=?').get(DEMO_SESSION_MARKER+'parent')!;
    const user={id:DEMO_PERSONAS.mentor.userId,email:DEMO_PERSONAS.mentor.userId+'@invalid.ttv'};
    const session={id:String(row.id),userAgent:String(row.userAgent)};
    await expect(validateDemoSession(f.env,new Request(DEMO_ORIGIN+'/dashboard/mentorship'),user,session,now)).resolves.toMatchObject({persona:'mentor'});
    f.sql.prepare('DELETE FROM session WHERE id=?').run('parent');
    await expect(validateDemoSession(f.env,new Request(DEMO_ORIGIN+'/dashboard/mentorship'),user,session,now)).rejects.toThrow("Demo access");
  });
  it('rejects production, disabled config, expired cutoff, CSRF, bearer bootstrap and arbitrary IDs',async()=>{
    const f=setup();
    expect((await handleDemoAction({...f.env,DEPLOYMENT_ENVIRONMENT:'production'},f.request(),'switch',now)).status).toBe(404);
    expect((await handleDemoAction({...f.env,STAGING_DEMO_ENABLED:undefined},f.request(),'switch',now)).status).toBe(404);
    expect((await handleDemoAction(f.env,f.request(),'switch',DEMO_CUTOFF)).status).toBe(404);
    for(const request of [f.request('admin'),f.request('__proto__'),f.request('mentor',{origin:'https://evil.invalid'}),f.request('mentor',{authorization:'Bearer unit-only'}),f.request('mentor',{cookie:cookieName+'=forged'})]) expect((await handleDemoAction(f.env,request,'switch',now)).status).toBeGreaterThanOrEqual(400);
    expect(f.sql.prepare('SELECT count(*) n FROM session').get()?.n).toBe(1);
  });
  it('refuses privilege drift and logs out both source and controlled sessions',async()=>{
    const f=setup();f.sql.prepare('INSERT INTO UserRoles VALUES(?,?,?)').run('unexpected',DEMO_PERSONAS.mentor.userId,'admin');
    expect((await handleDemoAction(f.env,f.request(),'switch',now)).status).toBe(409);
    f.sql.prepare('DELETE FROM UserRoles WHERE id=?').run('unexpected');
    await handleDemoAction(f.env,f.request(),'switch',now);
    const req=new Request(DEMO_ORIGIN+'/api/demo/logout',{method:'POST',headers:{origin:DEMO_ORIGIN,cookie:DEMO_OPERATOR_COOKIE+'='+signed('unit-parent-token')}});
    expect((await handleDemoAction(f.env,req,'logout',now)).status).toBe(200);
    expect(f.sql.prepare('SELECT count(*) n FROM session').get()?.n).toBe(0);
  });
  it('rolls back a failed switch without losing the existing persona session',async()=>{
    const f=setup();await handleDemoAction(f.env,f.request(),'switch',now);
    const before=f.sql.prepare('SELECT id FROM session WHERE userAgent=?').get(DEMO_SESSION_MARKER+'parent')?.id;
    f.sql.exec("CREATE TRIGGER refuse_new_session BEFORE INSERT ON session BEGIN SELECT RAISE(ABORT,'private database failure'); END");
    const response=await handleDemoAction(f.env,f.request('institution'),'switch',now+1);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('private database failure');
    expect(f.sql.prepare('SELECT id FROM session WHERE userAgent=?').get(DEMO_SESSION_MARKER+'parent')?.id).toBe(before);
  });
  it('denies unrelated mutation and credential surfaces',()=>{
    for(const p of ['/api/admin/users','/admin/agent-access','/api/auth/get-session','/api/community/access','/api/community/tokens','/api/mcp','/api/recordings']) expect(demoPathAllowed(p,'POST')).toBe(false);
    expect(demoPathAllowed('/api/community/chat','POST')).toBe(true);
    expect(demoPathAllowed('/dashboard','GET')).toBe(true);
  });
});

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticateQaCookie, logoutQa, qaHash, validateQaIdentity } from './staging-qa-access';
import { QA_COOKIE, QA_KEY_PIN, QA_MARKER, QA_RUN_ID, qaPathAllowed, qaSessionId } from './staging-qa-policy';
import { DEMO_ORIGIN, DEMO_PERSONAS, DEMO_PREFIX, type DemoPersona } from './staging-demo-policy';
import { handleQaCommunityRequest } from './community/staging-persona-qa';
const databases:DatabaseSync[]=[];
afterEach(()=>{databases.splice(0).forEach(db=>db.close());vi.useRealTimers();});
function setup(){
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));const now=Date.now()/1000;
 const sql=new DatabaseSync(':memory:');databases.push(sql);sql.function('unixepoch',()=>now);
 sql.exec(`PRAGMA foreign_keys=ON;CREATE TABLE user(id TEXT PRIMARY KEY,name TEXT,email TEXT,emailVerified INTEGER,image TEXT,createdAt INTEGER,updatedAt INTEGER);
 CREATE TABLE session(id TEXT PRIMARY KEY,userId TEXT,token TEXT,userAgent TEXT,createdAt INTEGER,updatedAt INTEGER,expiresAt INTEGER);
 CREATE TABLE Roles(id TEXT PRIMARY KEY,name TEXT UNIQUE,createdAt INTEGER,updatedAt INTEGER);CREATE TABLE UserRoles(id TEXT PRIMARY KEY,userId TEXT,roleId TEXT,UNIQUE(userId,roleId));
 CREATE TABLE program(id TEXT PRIMARY KEY,curriculumId TEXT,applicationsOpen INTEGER);CREATE TABLE programApplication(id TEXT PRIMARY KEY,userId TEXT,programId TEXT,status TEXT);`);
 for(const name of ['0017_community_discovery','0018_confirmation_role_snapshot','0020_retained_persona_qa'])sql.exec(readFileSync(new URL(`./db/migrations/${name}.sql`,import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
 sql.prepare('INSERT INTO stagingQaRun VALUES(?,?,?,?,?,?,?)').run(QA_RUN_ID,now,now+3600,null,'b'.repeat(40),QA_KEY_PIN,'seed-digest');
 sql.prepare('INSERT INTO program VALUES(?,?,0)').run(DEMO_PREFIX+'program',DEMO_PREFIX+'curriculum');
 const tokens:Record<string,string>={};
 for(const [persona,p]of Object.entries(DEMO_PERSONAS)){
  sql.prepare('INSERT INTO user VALUES(?,?,?,1,null,?,?)').run(p.userId,'Fictional '+persona,p.userId+'@invalid.ttv',now,now);
  if(p.role)sql.prepare('INSERT INTO UserRoles VALUES(?,?,(SELECT id FROM Roles WHERE name=?))').run(persona,p.userId,p.role);
  const token=(String(Object.keys(tokens).length+1)).repeat(64);tokens[persona]=token;
  sql.prepare('INSERT INTO session VALUES(?,?,?,?,?,?,?)').run(qaSessionId(persona as DemoPersona),p.userId,'unpublished-independent-session-value-'+persona,`${QA_MARKER}${QA_RUN_ID}:${persona}`,now,now,now+3600);
  sql.prepare('INSERT INTO stagingQaSession(tokenHash,sessionId,runId,userId,persona) VALUES(?,?,?,?,?)').run(qaHash(token),qaSessionId(persona as DemoPersona),QA_RUN_ID,p.userId,persona);
 }
 sql.prepare('INSERT OR IGNORE INTO Roles(id,name) VALUES(?,?)').run('admin','ADMIN');
 const member=DEMO_PERSONAS['member-cohort'].userId;sql.prepare('INSERT INTO programApplication VALUES(?,?,?,?)').run(member+'-application',member,DEMO_PREFIX+'program','APPROVED');
 sql.prepare('INSERT INTO session VALUES(?,?,?,?,?,?,?)').run('human-parent','real-admin','never-used','human',now,now,now+3600);
 sql.prepare('INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility) VALUES(?,?,?,?,?,?)').run('seed-journey',member,'Seed untouched','Existing fictional contribution','2026-10-24','institution');
 const db={prepare(query:string){let args:unknown[]=[];const s={bind(...v:unknown[]){args=v;return s;},async first(){return sql.prepare(query).get(...args as never[])??null;},async all(){return{results:sql.prepare(query).all(...args as never[])};},async run(){const r=sql.prepare(query).run(...args as never[]);return{success:true,meta:{changes:Number(r.changes)}};}};return s;},async batch(statements:{run:()=>Promise<unknown>}[]){sql.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}} as unknown as D1Database;
 const env={DB:db,DEPLOYMENT_ENVIRONMENT:'staging',STAGING_DEMO_ENABLED:'true'};
 const request=(persona:DemoPersona,path='/dashboard/community',method='GET',data?:unknown)=>new Request(DEMO_ORIGIN+path,{method,headers:{cookie:QA_COOKIE+'='+tokens[persona],origin:DEMO_ORIGIN,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 async function qa(persona:DemoPersona){return(await authenticateQaCookie(env,request(persona)))!.qa;}
 async function call(persona:DemoPersona,path:string,method='GET',data?:unknown){return handleQaCommunityRequest(request(persona,'/api/community/'+path,method,data),path,await qa(persona),env);}
 return{sql,env,request,qa,call,tokens,now};
}
describe('retained QA authoritative access and ledger',()=>{
 it('authenticates only four exact live fixed identities, without exposing a token in locals',async()=>{const f=setup();for(const persona of Object.keys(DEMO_PERSONAS)as DemoPersona[]){const auth=await authenticateQaCookie(f.env,f.request(persona));expect(auth?.qa.persona).toBe(persona);expect(auth?.session.token).toBe('');}});
 it.each(['production','disabled','expired','revoked','role','email','cohort','registry','extended','marker'])('rejects %s drift even after a successful cached read',async drift=>{
  const f=setup(),p='member-cohort';await f.qa(p);
  if(drift==='production')f.env.DEPLOYMENT_ENVIRONMENT='production';if(drift==='disabled')f.env.STAGING_DEMO_ENABLED='false';
  if(drift==='expired')vi.setSystemTime(new Date((f.now+3600)*1000));if(drift==='revoked')f.sql.prepare('UPDATE stagingQaRun SET revokedAt=?').run(f.now);
  if(drift==='role')f.sql.prepare('INSERT INTO UserRoles VALUES(?,?,(SELECT id FROM Roles WHERE name=?))').run('drift',DEMO_PERSONAS[p].userId,'ADMIN');
  if(drift==='email')f.sql.prepare('UPDATE user SET email=? WHERE id=?').run('real@example.com',DEMO_PERSONAS[p].userId);
  if(drift==='cohort')f.sql.exec('DELETE FROM programApplication');if(drift==='registry')f.sql.exec('DELETE FROM stagingQaSession');
  if(drift==='extended')f.sql.prepare('UPDATE session SET expiresAt=?').run(f.now+7200);if(drift==='marker')f.sql.exec("UPDATE session SET userAgent='human'");
  await expect(authenticateQaCookie(f.env,f.request(p))).rejects.toThrow('QA access');
 });
 it('rejects forged cookie and canonical-origin mismatch',async()=>{const f=setup();await expect(authenticateQaCookie(f.env,new Request(DEMO_ORIGIN,{headers:{cookie:QA_COOKIE+'='+'a'.repeat(64)}}))).rejects.toThrow('QA access');await expect(authenticateQaCookie(f.env,new Request('https://example.com',{headers:{cookie:QA_COOKIE+'='+f.tokens.mentor}}))).rejects.toThrow('QA access');});
 it('serves real community GET handlers for all four personas with staging context',async()=>{
  const f=setup();for(const persona of Object.keys(DEMO_PERSONAS)as DemoPersona[]){
   expect((await f.call(persona,'access')).status).toBe(200);expect((await f.call(persona,'profile')).status).toBe(200);expect((await f.call(persona,'journey')).status).toBe(200);
  }
  expect((await f.call('mentor','mentorship')).status).toBe(200);expect((await f.call('institution','profiles')).status).toBe(200);
 });
 it('rejects duplicate, mixed bearer and digest-as-cookie credentials',async()=>{
  const f=setup();const token=f.tokens.mentor;
  for(const headers of ([{cookie:`${QA_COOKIE}=${token}; ${QA_COOKIE}=${token}`},{cookie:`${QA_COOKIE}=${token}`,authorization:'Bearer fictional-invalid'},{cookie:`${QA_COOKIE}=${qaHash(token)}`} ] as Record<string,string>[]))await expect(authenticateQaCookie(f.env,new Request(DEMO_ORIGIN,{headers}))).rejects.toThrow('QA access');
 });
 it('denies cross-origin mutations before ledger insertion',async()=>{
  const f=setup(),qa=await f.qa('member-cohort');const request=new Request(DEMO_ORIGIN+'/api/community/journey',{method:'POST',headers:{origin:'https://evil.invalid'},body:JSON.stringify({title:`Fictional QA ${QA_RUN_ID}: unit`,description:'Fictional',occurredAt:'2026-10-25',visibility:'institution'})});
  expect((await handleQaCommunityRequest(request,'journey',qa,f.env)).status).toBe(403);expect(f.sql.prepare('SELECT COUNT(*) n FROM stagingQaResource').get()?.n).toBe(0);
 });
 it('allows new member ledger writes and mentor confirmation/revoke, preserving seed and human sessions',async()=>{
  const f=setup(),entry={title:`Fictional QA ${QA_RUN_ID}: Test contribution`,description:'Fictional work only',occurredAt:'2026-10-25',visibility:'institution'};
  const created=await f.call('member-cohort','journey','POST',entry);expect(created.status).toBe(201);const id=(await created.json() as {entry:{id:string}}).entry.id;
  expect((await f.call('member-cohort','journey/'+id,'PUT',{...entry,description:'Fictional updated evidence'})).status).toBe(200);
  expect((await f.call('member-noncohort','journey/'+id,'DELETE')).status).toBe(403);
  const confirmed=await f.call('mentor',`journey/${id}/confirmations`,'POST',{expectedRevision:2,statement:'Fictional QA reviewed the described change',method:'Fictional walkthrough'});expect(confirmed.status).toBe(201);const confirmationId=(await confirmed.json() as {confirmation:{id:string}}).confirmation.id;
  expect((await f.call('mentor','confirmations/'+confirmationId,'DELETE')).status).toBe(200);
  for(const method of ['PUT','PATCH','DELETE'])expect((await f.call('member-cohort','journey/seed-journey',method,method==='PUT'?entry:{visibility:'private'})).status).toBe(403);
  expect((await f.call('mentor','journey/seed-journey/confirmations','POST',{expectedRevision:1,statement:'Fictional QA',method:'Fictional'})).status).toBe(403);
  expect((await f.call('institution','journey','POST',entry)).status).toBe(403);
  expect((await f.call('member-cohort','journey/'+id,'DELETE')).status).toBe(200);
  expect(f.sql.prepare('SELECT title FROM communityJourney WHERE id=?').get('seed-journey')?.title).toBe('Seed untouched');
  const qa=await f.qa('mentor');expect((await logoutQa(f.env,f.request('mentor','/api/qa/logout','POST'),qa)).status).toBe(303);
  await expect(validateQaIdentity(f.env,qa.sessionId)).rejects.toThrow('QA access');expect(f.sql.prepare('SELECT id FROM session WHERE id=?').get('human-parent')).toBeTruthy();
 });
 it('rejects non-fictional titles, CSRF and revoked mutations with no new ledger entries',async()=>{const f=setup();const qa=await f.qa('member-cohort');const data={title:'Existing work',description:'Fictional',occurredAt:'2026-10-25',visibility:'institution'};expect((await f.call('member-cohort','journey','POST',data)).status).toBe(400);f.sql.prepare('UPDATE stagingQaRun SET revokedAt=?').run(f.now);expect((await handleQaCommunityRequest(f.request('member-cohort','/api/community/journey','POST',data),'journey',qa,f.env)).status).toBe(403);expect(f.sql.prepare('SELECT COUNT(*) n FROM stagingQaResource').get()?.n).toBe(0);});
 it.each(['/api/community/chat','/api/community/profile','/api/community/profiles/x/assessment','/api/auth/get-session','/api/auth/sign-out','/admin','/api/mcp','/demo','/api/demo/switch','/api/demo/logout','/api/community/tokens','/api/recordings','/dashboard/sessions'])('denies unrelated %s',path=>{for(const persona of Object.keys(DEMO_PERSONAS)as DemoPersona[])for(const method of ['GET','POST','PUT','DELETE'])if(!(path==='/api/community/profile'&&method==='GET'))expect(qaPathAllowed(persona,path,method)).toBe(false);});
});

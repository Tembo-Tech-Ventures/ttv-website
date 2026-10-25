import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validateStagingRevision } from './staging-preflight.mjs';
import { verifyStagingFixtureTarget, STAGING_FIXTURE_ORIGIN } from './staging-fixture-target.mjs';
import { verifyProbeBindings } from './staging-probe-state.mjs';
import { buildDemoDataset, DEMO_PERSONAS } from './staging-demo-data.mjs';
import { QA_RUN_ID, QA_COOKIE, QA_MARKER, QA_KEY_PIN } from '../../src/lib/staging-qa-config.mjs';
import { publicKeyFingerprint, sealQaHandoff } from './staging-persona-qa-envelope.mjs';
async function boundedFetch(url,options={}){return fetch(url,{...options,signal:options.signal?globalThis.AbortSignal.any([options.signal,globalThis.AbortSignal.timeout(15000)]):globalThis.AbortSignal.timeout(15000)});}
async function qaApi(path,{method='GET',body}={}){
 try{const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;ensure(/^[a-f0-9]{32}$/.test(account??'')&&Boolean(token));
 const response=await boundedFetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const payload=await response.json();ensure(response.ok&&payload.success!==false);return payload.result;
 }catch{throw new Error('Persona QA Cloudflare operation failed.');}
}
export const QA_ENCRYPTED_OUTPUT = new URL('../../test-results/persona-qa-encrypted.json',import.meta.url);
export const QA_USERS=Object.freeze(Object.entries(DEMO_PERSONAS).map(([key,userId])=>({persona:key==='cohort'?'member-cohort':key==='noncohort'?'member-noncohort':key,userId,sessionId:`${userId}-qa-${QA_RUN_ID}`})));
const rows=r=>(Array.isArray(r)?r:[r]).flatMap(s=>s?.results??[]);
const ensure=ok=>{if(!ok)throw new Error('Persona QA operation failed.');};
const query=(target,sql,params=[])=>target.executeQuery(sql,params).then(rows);
const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const ordered=items=>items.map(item=>Object.fromEntries(Object.entries(item).toSorted(([a],[b])=>a.localeCompare(b)))).toSorted((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
/** Hash only owned retained records; no auth tokens or raw database artifact. Human edits are never restored. */
export async function qaSeedDigest(target){
 const data=buildDemoDataset(),snapshot={};
 for(const[table,records]of Object.entries(data)){
  const key=table==='communityProfile'?'userId':'id';
  const found=await query(target,`SELECT * FROM "${table}" WHERE "${key}" IN (SELECT value FROM json_each(?))`,[JSON.stringify(records.map(r=>r[key]))]);
  ensure(found.length===records.length);snapshot[table]=ordered(found);
 }
 const ids=JSON.stringify(data.user.map(u=>u.id));
 const users=await query(target,"SELECT id FROM user WHERE id IN (SELECT value FROM json_each(?)) AND email=id || '@invalid.ttv'",[ids]);ensure(users.length===150);
 const roles=await query(target,'SELECT ur.id,ur.userId,ur.roleId FROM UserRoles ur WHERE ur.userId IN (SELECT value FROM json_each(?))',[ids]);snapshot.roles=ordered(roles);
 return digest(snapshot);
}
async function qaPersonaInvariants(target){
 for(const{persona,userId}of QA_USERS){
  const roles=await query(target,'SELECT r.name FROM UserRoles ur LEFT JOIN Roles r ON r.id=ur.roleId WHERE ur.userId=?',[userId]);const expected=persona==='mentor'?'MENTOR':persona==='institution'?'INSTITUTION':null;
  ensure(roles.length===(expected?1:0)&&(!expected||roles[0].name===expected));
  const owned=await query(target,'SELECT id FROM user WHERE id=? AND email=? AND emailVerified=1',[userId,userId+'@invalid.ttv']);ensure(owned.length===1);
  if(persona.startsWith('member-')){
   const membership=await query(target,"SELECT a.id FROM programApplication a JOIN program p ON p.id=a.programId WHERE a.userId=? AND a.id=? AND a.programId='ttv-staging-demo-v1-program' AND a.status='APPROVED' AND p.curriculumId='ttv-staging-demo-v1-curriculum' AND p.applicationsOpen=0",[userId,userId+'-application']);ensure((membership.length>0)===(persona==='member-cohort'));
  }
 }
}
async function count(target,sql,params){const found=await query(target,sql,params);ensure(found.length===1&&typeof found[0].n==='number');return found[0].n;}
/** Registry-first exact cleanup is safe after interrupted setup and never removes retained identities. */
export async function cleanupPersonaQa(target,audit=()=>{}){
 const run=(await query(target,'SELECT id,seedDigest FROM stagingQaRun WHERE id=?',[QA_RUN_ID]))[0];ensure(Boolean(run));
 const sessionIds=JSON.stringify(QA_USERS.map(p=>p.sessionId));
 const before=await count(target,'SELECT COUNT(*) n FROM session WHERE id NOT IN (SELECT value FROM json_each(?))',[sessionIds]);
 await target.executeQuery('UPDATE stagingQaRun SET revokedAt=coalesce(revokedAt,unixepoch()) WHERE id=?',[QA_RUN_ID]);
 const registry=await query(target,'SELECT sessionId,userId,persona FROM stagingQaSession WHERE runId=?',[QA_RUN_ID]);
 ensure(registry.every(r=>QA_USERS.some(p=>p.sessionId===r.sessionId&&p.userId===r.userId&&p.persona===r.persona)));
 await target.executeQuery('DELETE FROM stagingQaSession WHERE runId=? AND sessionId IN (SELECT value FROM json_each(?))',[QA_RUN_ID,sessionIds]);
 for(const{persona,userId,sessionId}of QA_USERS){
  const sessions=await query(target,'SELECT id,userId,userAgent FROM session WHERE id=?',[sessionId]);ensure(sessions.every(s=>s.userId===userId&&s.userAgent===`${QA_MARKER}${QA_RUN_ID}:${persona}`));
  await target.executeQuery('DELETE FROM session WHERE id=? AND userId=? AND userAgent=?',[sessionId,userId,`${QA_MARKER}${QA_RUN_ID}:${persona}`]);
 }
 const ledger=await query(target,'SELECT id,kind,userId FROM stagingQaResource WHERE runId=?',[QA_RUN_ID]);
 ensure(ledger.every(r=>r.id.startsWith(`ttv-qa-${QA_RUN_ID}-`)&&QA_USERS.some(p=>p.userId===r.userId)&&['journey','confirmation'].includes(r.kind)));
 for(const kind of ['confirmation','journey'])for(const resource of ledger.filter(r=>r.kind===kind)){
  const table=kind==='journey'?'communityJourney':'communityConfirmation',owner=kind==='journey'?'userId':'mentorId';
  const found=await query(target,`SELECT ${owner} AS owner FROM ${table} WHERE id=?`,[resource.id]);ensure(found.every(r=>r.owner===resource.userId));
  await target.executeQuery(`DELETE FROM ${table} WHERE id=? AND ${owner}=?`,[resource.id,resource.userId]);
  ensure(await count(target,`SELECT COUNT(*) n FROM ${table} WHERE id=?`,[resource.id])===0);
 }
 ensure(await count(target,'SELECT COUNT(*) n FROM stagingQaSession WHERE runId=?',[QA_RUN_ID])===0);
 ensure(await count(target,'SELECT COUNT(*) n FROM session WHERE id IN (SELECT value FROM json_each(?))',[sessionIds])===0);
 await target.executeQuery('DELETE FROM stagingQaResource WHERE runId=?',[QA_RUN_ID]);
 ensure(await count(target,'SELECT COUNT(*) n FROM stagingQaResource WHERE runId=?',[QA_RUN_ID])===0);
 const after=await count(target,'SELECT COUNT(*) n FROM session WHERE id NOT IN (SELECT value FROM json_each(?))',[sessionIds]);
 const humanSessionsUnchanged=before===after,seedUnchanged=run.seedDigest===await qaSeedDigest(target);
 const receipt={event:'persona-qa-cleanup',runId:QA_RUN_ID,revoked:true,sessionsRemaining:0,ledgerResourcesRemaining:0,humanSessionsUnchanged,seedUnchanged};audit(receipt);
 ensure(humanSessionsUnchanged&&seedUnchanged);return receipt;
}
export async function issuePersonaQa(target,{pem,version,now=Math.floor(Date.now()/1000),audit=()=>{}}){
 ensure(publicKeyFingerprint(pem)===QA_KEY_PIN);const expiresAt=Math.min(now+3600,Date.parse('2026-10-25T23:00:00Z')/1000);ensure(expiresAt>now&&Number.isSafeInteger(now));
 await qaPersonaInvariants(target);const seedDigest=await qaSeedDigest(target);
 ensure(await count(target,'SELECT COUNT(*) n FROM stagingQaRun WHERE id=?',[QA_RUN_ID])===0);
 ensure(await count(target,'SELECT COUNT(*) n FROM session WHERE id IN (SELECT value FROM json_each(?))',[JSON.stringify(QA_USERS.map(p=>p.sessionId))])===0);
 // The unique run tombstone is the once-only issuance claim. Never delete it or retry issuance after a partial setup.
 await target.executeQuery('INSERT INTO stagingQaRun(id,issuedAt,expiresAt,version,keyFingerprint,seedDigest) VALUES(?,?,?,?,?,?)',[QA_RUN_ID,now,expiresAt,version,QA_KEY_PIN,seedDigest]);
 const personas={};
 try{
  for(const{persona,userId,sessionId}of QA_USERS){
   const raw=randomBytes(32).toString('hex'),unpublishedToken=randomBytes(32).toString('hex');
   await target.executeQuery('INSERT INTO session(id,userId,token,userAgent,createdAt,updatedAt,expiresAt) SELECT ?,?,?,?,?,?,? FROM stagingQaRun WHERE id=? AND revokedAt IS NULL AND expiresAt>unixepoch()',[sessionId,userId,unpublishedToken,`${QA_MARKER}${QA_RUN_ID}:${persona}`,now,now,expiresAt,QA_RUN_ID]);
   await target.executeQuery('INSERT INTO stagingQaSession(tokenHash,sessionId,runId,userId,persona) SELECT ?,?,?,?,? FROM stagingQaRun WHERE id=? AND revokedAt IS NULL AND expiresAt>unixepoch()',[digest(raw),sessionId,QA_RUN_ID,userId,persona,QA_RUN_ID]);
   personas[persona]=[{name:QA_COOKIE,value:raw,url:STAGING_FIXTURE_ORIGIN,httpOnly:true,secure:true,sameSite:'Lax',expires:expiresAt}];
  }
  ensure(await count(target,'SELECT COUNT(*) n FROM stagingQaSession WHERE runId=?',[QA_RUN_ID])===4);
  const envelope=sealQaHandoff({personas},pem,{runId:QA_RUN_ID,issuedAt:now,expiresAt,version});
  audit({event:'persona-qa-issued',runId:QA_RUN_ID,issuedAt:now,expiresAt,version,personas:4,keyFingerprint:QA_KEY_PIN});
  return envelope;
 }catch{await cleanupPersonaQa(target,audit);throw new Error('Persona QA issuance failed; no reissue permitted.');}
 finally{for(const cookies of Object.values(personas))for(const cookie of cookies)cookie.value='';}
}
export async function runPersonaQa(environment=process.env,{api=qaApi,verify=verifyStagingFixtureTarget,validate=validateStagingRevision}={}){
 ensure(environment.GITHUB_RUN_ATTEMPT==='1');ensure(['persona-qa-issue','persona-qa-cleanup'].includes(environment.STAGING_ACTION));await validate(environment,{fetchImpl:boundedFetch});
 const target=await verify({environmentName:environment.CLOUDFLARE_ENVIRONMENT_NAME,accountId:environment.CLOUDFLARE_ACCOUNT_ID,expectedVersion:environment.STAGING_EXPECTED_SHA,baseUrl:STAGING_FIXTURE_ORIGIN,api,fetchImpl:boundedFetch});
 verifyProbeBindings((await api('/workers/scripts/ttv-website-staging/settings'))?.bindings,{probeEnabled:false,demoEnabled:true});
 if(environment.STAGING_ACTION==='persona-qa-cleanup')return cleanupPersonaQa(target,r=>console.log(JSON.stringify(r)));
 const recipient=JSON.parse(await readFile(new URL('./staging-persona-qa-recipient.json',import.meta.url),'utf8'));ensure(recipient.fingerprint===QA_KEY_PIN&&recipient.taskId==='01M5SBGP36V9P11F1CBY18PVW9');
 const envelope=await issuePersonaQa(target,{pem:recipient.publicKeyPem,version:environment.STAGING_EXPECTED_SHA,audit:r=>console.log(JSON.stringify(r))});
 try{await mkdir(new URL('.',QA_ENCRYPTED_OUTPUT),{recursive:true});await writeFile(QA_ENCRYPTED_OUTPUT,JSON.stringify(envelope)+'\n',{mode:0o600});}
 catch{await cleanupPersonaQa(target,r=>console.log(JSON.stringify(r)));throw new Error('Encrypted handoff publication failed.');}
 return{runId:envelope.runId,issuedAt:envelope.issuedAt,expiresAt:envelope.expiresAt};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{await runPersonaQa();}catch{console.error('Persona QA operation failed; no credential details emitted. Inspect sanitized receipts.');process.exitCode=1;}}

import { createHash } from 'node:crypto';
import { DEMO_CUTOFF, DEMO_ORIGIN, DEMO_PERSONAS, DEMO_PREFIX, demoEnabled, type DemoPersona } from './staging-demo-policy';
import { QA_COOKIE, QA_KEY_PIN, QA_MARKER, QA_RUN_ID, qaSessionId, type QaIdentity } from './staging-qa-policy';
export interface QaEnvironment {DB:D1Database;DEPLOYMENT_ENVIRONMENT?:string;STAGING_DEMO_ENABLED?:string}
export class QaAccessError extends Error {readonly status=403;constructor(){super('Temporary persona QA access is unavailable or expired.');}}
const deny=():never=>{throw new QaAccessError();};
export function hasQaCookie(request:Request){return request.headers.get('cookie')?.split(';').some(c=>c.trim().startsWith(QA_COOKIE+'='))??false;}
export function qaCookie(value:string,expiresAt:number){return `${QA_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt*1000).toUTCString()}`;}
export const qaHash=(value:string)=>createHash('sha256').update(value).digest('hex');
interface QaRow {runId:string;persona:DemoPersona;userId:string;sessionId:string;issuedAt:number;expiresAt:number;revokedAt:number|null;version:string;keyFingerprint:string;sessionCreatedAt:number;sessionExpiresAt:number;marker:string;tokenHash:string;name:string;email:string;emailVerified:number;image:string|null;userCreatedAt:number;userUpdatedAt:number}
function assertQaRow(row:QaRow|null,now:number):asserts row is QaRow {
 if(!row||!Object.hasOwn(DEMO_PERSONAS,row.persona)||row.runId!==QA_RUN_ID||row.keyFingerprint!==QA_KEY_PIN||row.revokedAt!==null||!row.emailVerified)return deny();
 if(row.userId!==DEMO_PERSONAS[row.persona].userId||row.email!==row.userId+'@invalid.ttv'||row.sessionId!==qaSessionId(row.persona)||row.marker!==`${QA_MARKER}${QA_RUN_ID}:${row.persona}`||!/^[a-f0-9]{64}$/.test(row.tokenHash))return deny();
 assertQaTimes(row,now);
}
function assertQaTimes(row:QaRow,now:number){
 if(![row.issuedAt,row.expiresAt,row.sessionCreatedAt,row.sessionExpiresAt,now].every(Number.isSafeInteger)||row.issuedAt>now||row.expiresAt<=now||row.expiresAt>Math.min(row.issuedAt+3600,DEMO_CUTOFF)||row.sessionCreatedAt!==row.issuedAt||row.sessionExpiresAt!==row.expiresAt)return deny();
}
export async function validateQaIdentity(env:QaEnvironment,sessionId:string,now=Math.floor(Date.now()/1000)):Promise<QaRow>{
 try{
  if(!demoEnabled(env.DEPLOYMENT_ENVIRONMENT,env.STAGING_DEMO_ENABLED,DEMO_ORIGIN,now))return deny();
  const row=await env.DB.prepare(`SELECT q.runId,q.persona,q.userId,q.sessionId,r.issuedAt,r.expiresAt,r.revokedAt,r.version,r.keyFingerprint,
    s.createdAt AS sessionCreatedAt,s.expiresAt AS sessionExpiresAt,s.userAgent AS marker,q.tokenHash,u.name,u.email,u.emailVerified,u.image,u.createdAt AS userCreatedAt,u.updatedAt AS userUpdatedAt
    FROM stagingQaSession q JOIN stagingQaRun r ON r.id=q.runId JOIN session s ON s.id=q.sessionId AND s.userId=q.userId JOIN user u ON u.id=q.userId WHERE q.sessionId=?`).bind(sessionId).first<QaRow>();
  assertQaRow(row,now);
  const {results:roles}=await env.DB.prepare('SELECT r.name FROM UserRoles ur LEFT JOIN Roles r ON ur.roleId=r.id WHERE ur.userId=?').bind(row.userId).all<{name:string}>();
  const expected=DEMO_PERSONAS[row.persona].role;if(roles.length!==(expected?1:0)||expected&&roles[0].name!==expected)return deny();
  if(row.persona.startsWith('member-')){
   const membership=await env.DB.prepare(`SELECT a.id FROM programApplication a JOIN program p ON p.id=a.programId WHERE a.userId=? AND a.id=? AND a.programId=? AND a.status='APPROVED' AND p.curriculumId=? AND p.applicationsOpen=0`).bind(row.userId,row.userId+'-application',DEMO_PREFIX+'program',DEMO_PREFIX+'curriculum').first();
   if(Boolean(membership)!==(row.persona==='member-cohort'))return deny();
  }
  return row;
 }catch{ return deny(); }
}
export async function authenticateQaCookie(env:QaEnvironment,request:Request){
 if(!hasQaCookie(request))return null;
 if(new URL(request.url).origin!==DEMO_ORIGIN||request.headers.has('authorization'))return deny();
 const values=request.headers.get('cookie')!.split(';').map(x=>x.trim()).filter(x=>x.startsWith(QA_COOKIE+'='));
 if(values.length!==1)return deny();const raw=values[0].slice(QA_COOKIE.length+1);if(!/^[a-f0-9]{64}$/.test(raw))return deny();
 const record=await env.DB.prepare('SELECT s.id FROM session s JOIN stagingQaSession q ON q.sessionId=s.id WHERE q.tokenHash=? AND q.runId=?').bind(qaHash(raw),QA_RUN_ID).first<{id:string}>();
 if(!record)return deny();const row=await validateQaIdentity(env,record.id);if(row.tokenHash!==qaHash(raw))return deny();
 const qa:QaIdentity={runId:row.runId,persona:row.persona,userId:row.userId,sessionId:row.sessionId,issuedAt:row.issuedAt,expiresAt:row.expiresAt};
 return {qa,user:{id:row.userId,name:row.name,email:row.email,emailVerified:true,image:row.image,createdAt:new Date(row.userCreatedAt*1000),updatedAt:new Date(row.userUpdatedAt*1000)},session:{id:row.sessionId,userId:row.userId,token:'',userAgent:row.marker,createdAt:new Date(row.issuedAt*1000),updatedAt:new Date(row.issuedAt*1000),expiresAt:new Date(row.expiresAt*1000)},personalAccessToken:null};
}
export async function logoutQa(env:QaEnvironment,request:Request,qa:QaIdentity){
 if(request.method!=='POST'||request.headers.get('origin')!==DEMO_ORIGIN)return deny();await validateQaIdentity(env,qa.sessionId);
 await env.DB.batch([env.DB.prepare('DELETE FROM stagingQaSession WHERE runId=? AND sessionId=? AND userId=?').bind(qa.runId,qa.sessionId,qa.userId),env.DB.prepare('DELETE FROM session WHERE id=? AND userId=? AND userAgent=?').bind(qa.sessionId,qa.userId,`${QA_MARKER}${qa.runId}:${qa.persona}`)]);
 return new Response(null,{status:303,headers:{Location:'/community/members','Cache-Control':'no-store','Set-Cookie':qaCookie('',0)}});
}

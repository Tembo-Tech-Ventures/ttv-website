import { createId } from '@paralleldrive/cuid2';
import { DEMO_ORIGIN, DEMO_PERSONAS, isDemoUser } from '../staging-demo-policy';
import { validateQaIdentity, type QaEnvironment } from '../staging-qa-access';
import { QA_MARKER, qaPathAllowed, type QaIdentity } from '../staging-qa-policy';
import { communityJson, handleCommunityRequest } from './http';
import { CommunityError, confirmationInput, journeyInput, parseInput } from './model';
const members=[DEMO_PERSONAS['member-cohort'].userId,DEMO_PERSONAS['member-noncohort'].userId];
const liveSql=`EXISTS (SELECT 1 FROM stagingQaSession q JOIN stagingQaRun r ON r.id=q.runId JOIN session s ON s.id=q.sessionId AND s.userId=q.userId
 WHERE q.runId=? AND q.sessionId=? AND q.userId=? AND r.revokedAt IS NULL AND r.issuedAt=s.createdAt AND r.expiresAt=s.expiresAt AND r.expiresAt>unixepoch() AND s.userAgent=?)`;
function liveValues(qa:QaIdentity){return [qa.runId,qa.sessionId,qa.userId,`${QA_MARKER}${qa.runId}:${qa.persona}`];}
const fail=():never=>{throw new CommunityError('Only this QA run’s new fictional contributions may be changed.',403);};
async function body(request:Request){
 const reader=request.body?.getReader();if(!reader)throw new CommunityError('Send a JSON object.');
 const decoder=new TextDecoder();let text='',bytes=0;
 try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>32000){await reader.cancel();throw new CommunityError('Request too large.',413);}text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
 try{return JSON.parse(text);}catch{throw new CommunityError('Send a JSON object.');}
}
async function owned(env:QaEnvironment,qa:QaIdentity,id:string,kind='journey',owner=qa.userId){
 const row=await env.DB.prepare('SELECT id FROM stagingQaResource WHERE id=? AND runId=? AND kind=? AND userId=?').bind(id,qa.runId,kind,owner).first();if(!row)return fail();
}
function tagged(input:unknown,qa:QaIdentity){const p=parseInput(journeyInput,input);if(!p.title.startsWith(`Fictional QA ${qa.runId}: `))throw new CommunityError(`Use the fictional QA run label in the title.`,400);return p;}
async function safeRead(response:Response,env:QaEnvironment){
 if(!response.ok)return response;
 const data=await response.json(),ids=new Set<string>();
 function collect(value:unknown){if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(collect);return;}for(const[k,v]of Object.entries(value)){if(['userId','mentorId'].includes(k)&&typeof v==='string')ids.add(v);else collect(v);}}
 collect(data);
 if([...ids].some(id=>!isDemoUser(id)))return fail();
 if(ids.size>0){const result=await env.DB.prepare('SELECT COUNT(*) AS n FROM user WHERE id IN (SELECT value FROM json_each(?)) AND email=id || ?').bind(JSON.stringify([...ids]),'@invalid.ttv').first<{n:number}>();if(result?.n!==ids.size)return fail();}
 return communityJson(data);
}
async function createQaJourney(env:QaEnvironment,qa:QaIdentity,request:Request){
 const db=env.DB;
   const p=tagged(await body(request),qa),newId=`ttv-qa-${qa.runId}-${createId()}`;
   const results=await db.batch([
    db.prepare(`INSERT INTO stagingQaResource(id,runId,kind,userId) SELECT ?,?,'journey',? WHERE ${liveSql}`).bind(newId,qa.runId,qa.userId,...liveValues(qa)),
    db.prepare(`INSERT INTO communityJourney(id,userId,title,description,evidenceUrl,occurredAt,visibility) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM stagingQaResource WHERE id=? AND runId=? AND kind='journey' AND userId=?) AND ${liveSql}`).bind(newId,qa.userId,p.title,p.description,p.evidenceUrl??null,p.occurredAt,p.visibility,newId,qa.runId,qa.userId,...liveValues(qa)),
   ]);if(results.some(r=>r.meta.changes!==1))return fail();return communityJson({entry:{id:newId,userId:qa.userId,...p,version:1,confirmations:[],createdAt:Math.floor(Date.now()/1000)}},201);
}

async function mutateQaJourney(env:QaEnvironment,qa:QaIdentity,request:Request,id:string){
 const db=env.DB;
   await owned(env,qa,id);let statement:D1PreparedStatement;
   if(request.method==='PUT'){const p=tagged(await body(request),qa);statement=db.prepare(`UPDATE communityJourney SET title=?,description=?,evidenceUrl=?,occurredAt=?,visibility=?,version=version+1,updatedAt=unixepoch() WHERE id=? AND userId=? AND ${liveSql}`).bind(p.title,p.description,p.evidenceUrl??null,p.occurredAt,p.visibility,id,qa.userId,...liveValues(qa));}
   else if(request.method==='PATCH'){const p=await body(request);if(!p||Object.keys(p).length!==1||!['private','institution'].includes(p.visibility))throw new CommunityError('Choose a visibility.');statement=db.prepare(`UPDATE communityJourney SET visibility=?,version=version+1,updatedAt=unixepoch() WHERE id=? AND userId=? AND ${liveSql}`).bind(p.visibility,id,qa.userId,...liveValues(qa));}
   else statement=db.prepare(`DELETE FROM communityJourney WHERE id=? AND userId=? AND ${liveSql}`).bind(id,qa.userId,...liveValues(qa));
   const result=await statement.run();if(result.meta.changes!==1)return fail();return communityJson({id,updated:request.method!=='DELETE',deleted:request.method==='DELETE'});
}

async function confirmQaJourney(env:QaEnvironment,qa:QaIdentity,request:Request,id:string){
 const db=env.DB;
   const p=parseInput(confirmationInput,await body(request));if(!p.statement.startsWith('Fictional QA'))throw new CommunityError('Label the fictional QA confirmation.');
   const journey=await db.prepare(`SELECT j.userId,j.version FROM communityJourney j JOIN stagingQaResource l ON l.id=j.id AND l.kind='journey' AND l.userId=j.userId WHERE l.runId=? AND j.id=? AND j.userId IN (?,?) AND j.visibility='institution'`).bind(qa.runId,id,...members).first<{userId:string;version:number}>();
   if(!journey)return fail();if(journey.version!==p.expectedRevision)throw new CommunityError('Contribution changed. Review its current revision.',409);
   const confirmationId=`ttv-qa-${qa.runId}-${createId()}`;
   const result=await db.batch([
    db.prepare(`INSERT INTO stagingQaResource(id,runId,kind,userId) SELECT ?,?,'confirmation',? WHERE ${liveSql}`).bind(confirmationId,qa.runId,qa.userId,...liveValues(qa)),
    db.prepare(`INSERT INTO communityConfirmation(id,journeyId,mentorId,statement,method,journeyVersion,mentorRole) SELECT ?,j.id,?,?,?,j.version,'MENTOR' FROM communityJourney j JOIN stagingQaResource l ON l.id=j.id AND l.runId=? AND l.kind='journey' AND l.userId=j.userId WHERE j.id=? AND j.userId IN (?,?) AND j.version=? AND j.visibility='institution' AND ${liveSql}`).bind(confirmationId,qa.userId,p.statement,p.method,qa.runId,id,...members,p.expectedRevision,...liveValues(qa)),
   ]);if(result.some(r=>r.meta.changes!==1))return fail();return communityJson({confirmation:{id:confirmationId,journeyId:id,mentorId:qa.userId,...p,journeyVersion:p.expectedRevision,mentorRole:'MENTOR'}},201);
}

async function revokeQaConfirmation(env:QaEnvironment,qa:QaIdentity,id:string){
 const db=env.DB;
   await owned(env,qa,id,'confirmation');const result=await db.prepare(`DELETE FROM communityConfirmation WHERE id=? AND mentorId=? AND ${liveSql}`).bind(id,qa.userId,...liveValues(qa)).run();if(result.meta.changes!==1)return fail();return communityJson({deleted:true});
}
export async function handleQaCommunityRequest(request:Request,path:string,qa:QaIdentity,env:QaEnvironment){
 try{
  const current=await validateQaIdentity(env,qa.sessionId);
  if(current.runId!==qa.runId||current.userId!==qa.userId||current.persona!==qa.persona||current.expiresAt!==qa.expiresAt)return fail();
  if(!qaPathAllowed(qa.persona,'/api/community/'+path,request.method))return fail();
  if(request.method==='GET')return await safeRead(await handleCommunityRequest(request,path,{id:qa.userId,scopes:null,delegatedSession:true,demo:{persona:qa.persona}},env.DB,env as Env),env);
  if(request.headers.get('origin')!==DEMO_ORIGIN)return fail();
  const parts=path.split('/'),id=parts[1];
  if(path==='journey')return await createQaJourney(env,qa,request);
  if(parts[0]==='journey'&&parts.length===2)return await mutateQaJourney(env,qa,request,id);
  if(parts[0]==='journey'&&parts.length===3&&parts[2]==='confirmations')return await confirmQaJourney(env,qa,request,id);
  if(parts[0]==='confirmations'&&parts.length===2)return await revokeQaConfirmation(env,qa,id);
  return fail();
 }catch(error){return communityJson({error:error instanceof CommunityError?error.message:'Temporary persona QA request is unavailable.'},error instanceof CommunityError?error.status:403);}
}

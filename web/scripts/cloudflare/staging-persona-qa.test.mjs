import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDemoDataset, DEMO_PERSONAS } from './staging-demo-data.mjs';
import { QA_USERS, cleanupPersonaQa, issuePersonaQa, qaSeedDigest } from './staging-persona-qa.mjs';
import { QA_RUN_ID } from '../../src/lib/staging-qa-config.mjs';
const dbs=[];afterEach(()=>{dbs.splice(0).forEach(db=>db.close());vi.useRealTimers();});
const pem=JSON.parse(readFileSync(new URL('./staging-persona-qa-recipient.json',import.meta.url),'utf8')).publicKeyPem;
function fixture(){
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));const now=Date.now()/1000;
 const sql=new DatabaseSync(':memory:');dbs.push(sql);sql.function('unixepoch',()=>now);
 sql.exec(`CREATE TABLE user(id TEXT PRIMARY KEY,name TEXT,email TEXT,emailVerified INTEGER,image TEXT,createdAt INTEGER,updatedAt INTEGER);
 CREATE TABLE session(id TEXT PRIMARY KEY,userId TEXT,token TEXT,userAgent TEXT,createdAt INTEGER,updatedAt INTEGER,expiresAt INTEGER);
 CREATE TABLE Roles(id TEXT PRIMARY KEY,name TEXT UNIQUE,createdAt INTEGER,updatedAt INTEGER);CREATE TABLE UserRoles(id TEXT PRIMARY KEY,userId TEXT,roleId TEXT,UNIQUE(userId,roleId));
 CREATE TABLE curriculum(id TEXT PRIMARY KEY,title TEXT,description TEXT,createdAt INTEGER,updatedAt INTEGER);
 CREATE TABLE program(id TEXT PRIMARY KEY,name TEXT,description TEXT,curriculumId TEXT,applicationsOpen INTEGER,createdAt INTEGER,updatedAt INTEGER);
 CREATE TABLE programApplication(id TEXT PRIMARY KEY,userId TEXT,programId TEXT,status TEXT,application TEXT,createdAt INTEGER,updatedAt INTEGER);`);
 for(const name of ['0017_community_discovery','0018_confirmation_role_snapshot','0020_retained_persona_qa'])sql.exec(readFileSync(new URL(`../../src/lib/db/migrations/${name}.sql`,import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
 for(const[table,records]of Object.entries(buildDemoDataset()))for(const row of records){const keys=Object.keys(row);sql.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));}
 for(const[persona,role]of [['mentor','MENTOR'],['institution','INSTITUTION']])sql.prepare('INSERT INTO UserRoles VALUES(?,?,(SELECT id FROM Roles WHERE name=?))').run('seed-role-'+persona,DEMO_PERSONAS[persona],role);
 sql.prepare('INSERT INTO session VALUES(?,?,?,?,?,?,?)').run('human-parent','human-user','fictional-unit-human-token','human',now,now,now+3600);
 const target={expectedVersion:'b'.repeat(40),async executeQuery(query,params=[]){const statement=sql.prepare(query);if(statement.columns().length>0)return[{results:statement.all(...params)}];const r=statement.run(...params);return[{results:[],meta:{changes:Number(r.changes)}}];}};
 return{sql,target,now};
}
describe('one-shot encrypted persona issuer and exact cleanup',()=>{
 it('issues exactly four fixed contexts once and leaves only ciphertext outside the process',async()=>{
  const f=fixture(),audit=vi.fn();const envelope=await issuePersonaQa(f.target,{pem,version:f.target.expectedVersion,audit});
  expect(QA_USERS.map(p=>p.persona).toSorted()).toEqual(['institution','member-cohort','member-noncohort','mentor']);
  expect(envelope).toMatchObject({runId:QA_RUN_ID,issuedAt:f.now,expiresAt:f.now+3600});expect(Array.isArray(envelope.personas)).toBe(true);expect(JSON.stringify(envelope)).not.toContain('"value":');
  expect(f.sql.prepare('SELECT COUNT(*) n FROM stagingQaSession').get().n).toBe(4);
  const credentials=f.sql.prepare('SELECT q.tokenHash,s.token FROM stagingQaSession q JOIN session s ON s.id=q.sessionId').all();expect(credentials.every(r=>r.tokenHash!==r.token&&r.tokenHash.length===64)).toBe(true);
  for(const r of credentials){expect(JSON.stringify(envelope)).not.toContain(r.tokenHash);expect(JSON.stringify(audit.mock.calls)).not.toContain(r.tokenHash);}
  await expect(issuePersonaQa(f.target,{pem,version:f.target.expectedVersion})).rejects.toThrow('operation failed');expect(f.sql.prepare('SELECT COUNT(*) n FROM stagingQaSession').get().n).toBe(4);
  const receipt=await cleanupPersonaQa(f.target);expect(receipt).toMatchObject({revoked:true,sessionsRemaining:0,ledgerResourcesRemaining:0,humanSessionsUnchanged:true,seedUnchanged:true});expect(f.sql.prepare('SELECT id FROM session').get().id).toBe('human-parent');expect(f.sql.prepare('SELECT revokedAt FROM stagingQaRun').get().revokedAt).toBe(f.now);
 });
 it('cleans exact ledger-created rows and never restores over a human seed edit',async()=>{
  const f=fixture();await issuePersonaQa(f.target,{pem,version:f.target.expectedVersion});const id=`ttv-qa-${QA_RUN_ID}-unit`,user=DEMO_PERSONAS.cohort;
  f.sql.prepare('INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility) VALUES(?,?,?,?,?,?)').run(id,user,'Fictional QA new','Fictional','2026-10-25','institution');
  f.sql.prepare('INSERT INTO stagingQaResource VALUES(?,?,?,?)').run(id,QA_RUN_ID,'journey',user);
  const seed=buildDemoDataset().communityJourney[0].id;f.sql.prepare('UPDATE communityJourney SET title=? WHERE id=?').run('Human fictional edit preserved',seed);
  const audit=vi.fn();await expect(cleanupPersonaQa(f.target,audit)).rejects.toThrow('operation failed');
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({seedUnchanged:false,sessionsRemaining:0}));expect(f.sql.prepare('SELECT id FROM communityJourney WHERE id=?').get(id)).toBeUndefined();expect(f.sql.prepare('SELECT title FROM communityJourney WHERE id=?').get(seed).title).toBe('Human fictional edit preserved');
 });
 it('rejects identity/role drift before claiming a run or creating sessions',async()=>{
  const f=fixture();f.sql.prepare('UPDATE user SET email=? WHERE id=?').run('not-owned@example.com',DEMO_PERSONAS.mentor);
  await expect(issuePersonaQa(f.target,{pem,version:f.target.expectedVersion})).rejects.toThrow('operation failed');expect(f.sql.prepare('SELECT COUNT(*) n FROM stagingQaRun').get().n).toBe(0);
 });
 it('revokes partial setup without reissuing when an insert fails',async()=>{
  const f=fixture();const original=f.target.executeQuery;let inserted=0;f.target.executeQuery=async(query,args)=>{if(query.startsWith('INSERT INTO stagingQaSession')&&++inserted===2)throw new Error('fictional failure not published');return original(query,args);};
  await expect(issuePersonaQa(f.target,{pem,version:f.target.expectedVersion})).rejects.toThrow('no reissue permitted');expect(f.sql.prepare('SELECT COUNT(*) n FROM stagingQaSession').get().n).toBe(0);expect(f.sql.prepare('SELECT COUNT(*) n FROM session').get().n).toBe(1);expect(f.sql.prepare('SELECT revokedAt FROM stagingQaRun').get().revokedAt).toBe(f.now);
 });
 it('does not change the retained dataset while snapshotting it',async()=>{const f=fixture();const a=await qaSeedDigest(f.target),b=await qaSeedDigest(f.target);expect(a).toBe(b);});
});

it('writes to the workflow upload path regardless of repository-root or other cwd',()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),moduleUrl=new URL('./staging-persona-qa.mjs',import.meta.url).href;
 const workflow=readFileSync(new URL('../../../.github/workflows/cloudflare-staging.yml',import.meta.url),'utf8');const job=workflow.slice(workflow.indexOf('  persona-qa:'));
 const upload=job.match(/path: (web\/test-results\/persona-qa-encrypted\.json)/)?.[1];expect(upload).toBeDefined();
 for(const cwd of [root,tmpdir()]){
  const result=execFileSync(process.execPath,['--input-type=module','-e',`import{fileURLToPath}from'node:url';import{QA_ENCRYPTED_OUTPUT}from ${JSON.stringify(moduleUrl)};process.stdout.write(fileURLToPath(QA_ENCRYPTED_OUTPUT));`],{cwd,encoding:'utf8'});
  expect(result).toBe(resolve(root,upload));expect(relative(root,result)).toBe('web/test-results/persona-qa-encrypted.json');
 }
});

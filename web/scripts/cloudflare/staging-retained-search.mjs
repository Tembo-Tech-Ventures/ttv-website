import { pathToFileURL } from 'node:url';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { cfApi } from './lib.mjs';
import { validateStagingRevision } from './staging-preflight.mjs';
import { verifyStagingFixtureTarget, STAGING_FIXTURE_ORIGIN } from './staging-fixture-target.mjs';
import { withStagingPersonas } from './staging-personas.mjs';
import { buildDemoDataset } from './staging-demo-data.mjs';
const reportPath='test-results/staging-retained-search.json';
const resultRows=result=>(Array.isArray(result)?result:[result]).flatMap(r=>r?.results??[]);
export const RETAINED_CASES=Object.freeze([
 {label:'React+TypeScript',query:'TypeScript',skills:['React']}, {label:'Python+SQL',query:'Python',skills:['SQL']},
 {label:'Accessibility',query:'Accessibility',skills:[]}, {label:'Kotlin',query:'Kotlin',skills:[]},
 {label:'incompatible skills',query:'',skills:['React','Kotlin']},{label:'no match',query:'NoSuchFictionalSkill2026',skills:[]},
 {label:'cohort',query:'Fictional Grace Wanjiku',skills:[]},{label:'noncohort',query:'Fictional David Wanjiku',skills:[]},
 {label:'mentor excluded',query:'Fictional Amina Wanjiku',skills:[]},{label:'casefold',query:'typescript',skills:['react']},
]);
export function expectedMatches(profiles,{query='',skills=[],limit=50}) {
 return profiles.filter(p=>!p.excluded && [p.name,p.headline,p.skills,p.bio].join(' ').toLowerCase().includes(query.toLowerCase()) && skills.every(s=>JSON.parse(p.skills??'[]').some(v=>v.toLowerCase()===s.toLowerCase())))
 .toSorted((a,b)=>a.name<b.name?-1:a.name>b.name?1:a.id<b.id?-1:a.id>b.id?1:0).slice(0,limit).map(p=>p.id);
}
function ensure(ok){if(!ok)throw new Error('Retained probe verification failed.');}
export async function runRetainedSearch({environment=process.env,api=cfApi,fetchImpl=fetch,validateRevision=validateStagingRevision,verifyTarget=verifyStagingFixtureTarget,withPersonas=withStagingPersonas}={}) {
 await rm(reportPath,{force:true});
 ensure(environment.GITHUB_RUN_ATTEMPT==='1' && environment.STAGING_ACTION==='retained-read-probe');
 await validateRevision(environment);
 const target=await verifyTarget({environmentName:environment.CLOUDFLARE_ENVIRONMENT_NAME,accountId:environment.CLOUDFLARE_ACCOUNT_ID,expectedVersion:environment.STAGING_EXPECTED_SHA,baseUrl:STAGING_FIXTURE_ORIGIN,api,fetchImpl});
 const bindings=(await api('/workers/scripts/ttv-website-staging/settings'))?.bindings??[];
 ensure(bindings.some(b=>b.name==='STAGING_RETAINED_READ_PROBE_ENABLED'&&b.text==='true') && bindings.some(b=>b.name==='AI'&&b.type==='ai') && bindings.some(b=>b.name==='AI_GATEWAY_NAME'&&b.text==='ttv-website-ai-staging'));
 const ids=buildDemoDataset().user.map(u=>u.id), placeholders='SELECT value FROM json_each(?)', idJson=JSON.stringify(ids);
 const profiles=resultRows(await target.executeQuery(`SELECT u.id,u.email,u.name,p.headline,p.skills,p.bio,EXISTS(SELECT 1 FROM UserRoles ur JOIN Roles r ON r.id=ur.roleId WHERE ur.userId=u.id AND r.name IN ('ADMIN','MENTOR')) AS excluded FROM user u LEFT JOIN communityProfile p ON p.userId=u.id WHERE u.id IN (${placeholders})`,[idJson]));
 ensure(profiles.length===150 && profiles.every(u=>ids.includes(u.id)&&u.email===`${u.id}@invalid.ttv`));
 const sources=resultRows(await target.executeQuery(`SELECT u.id,'profile' AS kind,p.version FROM user u JOIN communityProfile p ON p.userId=u.id WHERE u.id IN (${placeholders}) UNION ALL SELECT j.id,'journey' AS kind,j.version FROM communityJourney j WHERE j.userId IN (${placeholders}) AND j.visibility='institution' UNION ALL SELECT c.id,'confirmation' AS kind,c.journeyVersion AS version FROM communityConfirmation c JOIN communityJourney j ON j.id=c.journeyId WHERE j.userId IN (${placeholders}) AND c.mentorId IN (${placeholders}) AND j.visibility='institution' AND c.journeyVersion=j.version`,[idJson,idJson,idJson,idJson]));
 const sourceKeys=new Set(sources.map(s=>`${s.kind}:${s.id}:${s.version}`));
 const report={version:target.expectedVersion,fictional:true,directory:{population:profiles.length,eligible:profiles.filter(p=>!p.excluded).length,cases:[],pagination:'Limit/default20/max50 only; no cursor/offset or whole-directory pagination proof.'},chat:null,cleanup:'pending'};
 await withPersonas({target,signingSecret:environment.BETTER_AUTH_SECRET,retainedReadProbe:true,audit:record=>console.log(JSON.stringify(record)),run:async personas=>{
  async function request(actor,path,method='GET',body){const start=globalThis.performance.now();const r=await fetchImpl(`${target.baseUrl}/api/community/${path}`,{method,headers:{Authorization:`Bearer ${actor.personalAccessToken}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:globalThis.AbortSignal.timeout(method==='POST'?75000:15000)});return {status:r.status,data:await r.json(),latencyMs:Math.round(globalThis.performance.now()-start)};}
  for(const test of [...RETAINED_CASES,{label:'default limit',query:'',skills:[],limit:20},{label:'limit1',query:'',skills:[],limit:1},{label:'limit2',query:'',skills:[],limit:2},{label:'max50',query:'',skills:[],limit:50}]){
   const params=new globalThis.URLSearchParams({query:test.query,skills:test.skills.join(',')});if(test.label!=='default limit')params.set('limit',String(test.limit??50));
   const actual=await request(personas.institution,`profiles?${params}`), expected=expectedMatches(profiles,test), actualIds=actual.data.profiles?.map(p=>p.userId);
   ensure(actual.status===200&&JSON.stringify(actualIds)===JSON.stringify(expected));report.directory.cases.push({label:test.label,status:actual.status,expected,actual:actualIds,latencyMs:actual.latencyMs});
  }
  for(const [label,actor,path,expectedStatus] of [['no-role',personas.unapprovedInstitution,'profiles',403],['invalid-limit',personas.institution,'profiles?limit=51',400],['non-retained',personas.institution,'profiles/not-a-demo-user',403]]){
   const actual=await request(actor,path);ensure(actual.status===expectedStatus);report.directory.cases.push({label,status:actual.status,latencyMs:actual.latencyMs});
  }
  const detailId=ids.find(id=>id.endsWith('member-noncohort'));const detail=await request(personas.institution,`profiles/${detailId}`);ensure(detail.status===200&&detail.data.profile.userId===detailId&&detail.data.entries.every(j=>j.visibility==='institution'&&j.confirmations.every(c=>ids.includes(c.mentorId))));
  report.directory.cases.push({label:'published detail only',status:detail.status,id:detailId,entries:detail.data.entries.length,latencyMs:detail.latencyMs});
  const chat=await request(personas.institution,'chat','POST',{message:'Find fictional Kotlin/Android builders in this demo. Use search and published detail evidence, explain a small selection with citations and missing evidence. Do not rank ability or claim external links were visited.'});
  ensure(chat.status===200&&chat.data.grounded===true&&chat.data.citations?.some(s=>s.kind==='journey')&&chat.data.retrievedSources?.some(s=>s.kind==='journey')&&chat.data.execution?.model==='@cf/zai-org/glm-5.3-flash'&&chat.data.execution.modelSteps<=3&&chat.data.execution.executedToolCalls<=6&&chat.data.execution.executedToolCalls>=2);
  for(const s of [...chat.data.citations,...chat.data.retrievedSources])ensure(ids.includes(s.userId)&&sourceKeys.has(`${s.kind}:${s.id}:${s.version}`));
  report.chat={status:chat.status,latencyMs:chat.latencyMs,execution:chat.data.execution,citations:chat.data.citations.map(({kind,id,userId,version})=>({kind,id,userId,version})),retrievedSources:chat.data.retrievedSources.map(({kind,id,userId,version})=>({kind,id,userId,version})),missingEvidenceLanguage:/missing|insufficient|unknown|not documented|no evidence/i.test(chat.data.answer),semanticReviewRequired:true,ranking:'Tool retrieval plus generated cited summary; no ability ranking quality claim.',toolNameTrace:'Existing response exposes counts, not actual tool names.'};
 }});
 report.cleanup='verified';await mkdir('test-results',{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{await runRetainedSearch();console.log('Retained directory/chat verification and disposable cleanup passed.');}catch{console.error('Retained probe failed; no evidence published. Inspect sanitized cleanup receipt.');process.exitCode=1;}}

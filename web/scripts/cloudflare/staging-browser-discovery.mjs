import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { assertJourneyScope } from './staging-community-journey.mjs';
export const DISCOVERY_QUERY=Object.freeze({context:"We're trying to hire someone to work on field projects with elephant tracking data. They need to be able to use python to work with our existing tooling, and they should have first-aid training.",skills:"python, first-aid",query:""});
export function assertDiscoveryResult(data,id) {
 assert.equal(data.profiles?.[0]?.profile?.userId,id);
 const matches=data.profiles[0].matches;
 assert.ok(matches.some(m=>/python/i.test(m.criterion.text)&&m.status==='supported'));
 assert.ok(matches.some(m=>/first[ -]?aid/i.test(m.criterion.text)&&m.status==='supported'));
 assert.ok(matches.every(m=>!(/elephant/i.test(m.criterion.text))||m.status==='unknown'));
 assert.ok(data.evaluated<=20 && data.searched<=6);
}
/** Same-run synthetic data only; all writes cascade away with the existing persona lifecycle. */
export async function verifyBrowserDiscovery({target,contextsByRole,personas}) {
 assertJourneyScope({baseUrl:target.baseUrl,contextsByRole,users:personas});
 const member=contextsByRole.member.request;
 const options={headers:{Origin:target.baseUrl},maxRedirects:0};
 const saved=await member.put('/api/community/profile',{...options,data:{headline:'Python developer',bio:'I build Python data-analysis tools.',skills:['Python'],opportunityGoals:'Field data work'}});assert.equal(saved.status(),200);
 const course=await member.post('/api/community/journey',{...options,data:{title:'First Aid Course',description:'I completed a First Aid at Work course.',occurredAt:'2026-10-08',visibility:'institution'}});assert.equal(course.status(),201);
 const page=await contextsByRole.institution.newPage();
 try {
  await page.goto(`${target.baseUrl}/dashboard/discover`,{waitUntil:'networkidle'});
  await page.getByLabel('What are you working on?').fill(DISCOVERY_QUERY.context);
  await page.getByLabel('Skills to explore').fill(DISCOVERY_QUERY.skills);
  const responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/community/profiles/discover',{timeout:75000});
  const started=Date.now();await page.getByRole('button',{name:'Discover people',exact:true}).click();
  const response=await responsePromise;assert.equal(response.status(),200);const data=await response.json();assertDiscoveryResult(data,personas.member.userId);
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000});
   await expect(page.locator('.discovery-person').first().getByText(/first[ -]?aid/i)).toBeVisible();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  }
  console.log(JSON.stringify({event:'discovery-live-verified',latencyMs:Date.now()-started,evaluated:data.evaluated,viewports:[1440,390],python:'supported',firstAid:'supported'}));
 } finally {await page.close();}
}

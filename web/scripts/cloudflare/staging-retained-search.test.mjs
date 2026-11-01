import { describe, expect, it, vi } from 'vitest';
import { runRetainedSearch, expectedMatches } from './staging-retained-search.mjs';
import { buildDemoDataset } from './staging-demo-data.mjs';
describe('retained runner safeguards',()=>{
 it('refuses retry or other action before credentials/issuance',async()=>{
  const validateRevision=vi.fn(),api=vi.fn(),withPersonas=vi.fn();
  for(const environment of [{GITHUB_RUN_ATTEMPT:'2',STAGING_ACTION:'retained-read-probe'},{GITHUB_RUN_ATTEMPT:'1',STAGING_ACTION:'verify'}]) await expect(runRetainedSearch({environment,validateRevision,api,withPersonas})).rejects.toThrow('verification failed');
  expect(validateRevision).not.toHaveBeenCalled();expect(api).not.toHaveBeenCalled();expect(withPersonas).not.toHaveBeenCalled();
 });
 it('refuses missing runtime flag/bindings before retained data or fixture creation',async()=>{
  const executeQuery=vi.fn(),withPersonas=vi.fn();
  await expect(runRetainedSearch({environment:{GITHUB_RUN_ATTEMPT:'1',STAGING_ACTION:'retained-read-probe'},validateRevision:vi.fn(),verifyTarget:async()=>({executeQuery}),api:async()=>({bindings:[]}),withPersonas})).rejects.toThrow('verification failed');
  expect(executeQuery).not.toHaveBeenCalled();expect(withPersonas).not.toHaveBeenCalled();
 });
 it('computes literal filters and stable alphabetical limits independently from fresh seed',()=>{
  const data=buildDemoDataset(), profiles=data.user.map(u=>({...u,...data.communityProfile.find(p=>p.userId===u.id),saved:data.communityProfile.some(p=>p.userId===u.id),excluded:u.id.endsWith('-mentor')}));
  expect(expectedMatches(profiles,{query:'Kotlin',limit:50})).toHaveLength(15);
  // Institutional discovery lists only saved community profiles.
  const [first]=expectedMatches(profiles,{query:'Kotlin',limit:1});
  expect(expectedMatches(profiles.map(p=>p.id===first?{...p,saved:false}:p),{query:'Kotlin',limit:50})).toHaveLength(14);
  expect(expectedMatches(profiles,{skills:['React','Kotlin']})).toEqual([]);
  expect(expectedMatches(profiles,{query:'TypeScript',skills:['react']})).toEqual(expectedMatches(profiles,{query:'typescript',skills:['React']}));
  expect(expectedMatches(profiles,{query:'',limit:2})).toEqual(expectedMatches(profiles,{query:'',limit:50}).slice(0,2));
 });
});

import { describe, expect, it, vi } from 'vitest';
import { runRetainedSearch, expectedMatches, RETAINED_CASES } from './staging-retained-search.mjs';
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
  const data=buildDemoDataset(), profiles=data.user.map(u=>({...u,...data.communityProfile.find(p=>p.userId===u.id),excluded:u.id.endsWith('-mentor')}));
  expect(expectedMatches(profiles,{query:'Kotlin',limit:50})).toHaveLength(15);
  expect(expectedMatches(profiles,{skills:['React','Kotlin']})).toEqual([]);
  expect(expectedMatches(profiles,{query:'TypeScript',skills:['react']})).toEqual(expectedMatches(profiles,{query:'typescript',skills:['React']}));
  expect(expectedMatches(profiles,{query:'',limit:2})).toEqual(expectedMatches(profiles,{query:'',limit:50}).slice(0,2));
 });
});

it('narrows the new proposal to React inference and directory-only Kotlin/no-match checks',async()=>{
 expect(RETAINED_CASES.map(c=>c.label)).toEqual(['React','Kotlin','no match']);
 const validateRevision=vi.fn(),withPersonas=vi.fn();
 for(const query of ['Kotlin','Python','NoSuchFictionalSkill2026'])await expect(runRetainedSearch({environment:{GITHUB_RUN_ATTEMPT:'1',STAGING_ACTION:'retained-read-probe',STAGING_RETAINED_QUERY:query},validateRevision,withPersonas})).rejects.toThrow('verification failed');
 expect(validateRevision).not.toHaveBeenCalled();expect(withPersonas).not.toHaveBeenCalled();
});

it('the proposed workflow input defaults only to the fixed React case and keeps the enable flag default OFF',async()=>{
 const {readFile}=await import('node:fs/promises');const text=await readFile(new URL('../../../.github/workflows/cloudflare-staging.yml',import.meta.url),'utf8');expect(text).toContain('default: React\n        options: [React]');expect(text).toContain('retained_read_probe_enabled:\n        description: Temporary retained read probe flag (explicit owner approval required; return off after run)\n        required: false\n        type: boolean\n        default: false');
});

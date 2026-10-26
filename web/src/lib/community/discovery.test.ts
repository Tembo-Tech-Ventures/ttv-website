import { describe,it,expect,vi } from "vitest";
import { discoverProfiles,chunks,cosine, type DiscoveryDependencies } from "./discovery";
import type { CommunityService } from "./service";
const input={context:"Elephant tracking field projects. Need Python; should have first-aid training.",skills:"python, first-aid",query:""};
const criteria=[{text:"Python programming",importance:"required"},{text:"first-aid training",importance:"requested"}];
function setup() {
  const evidence:Awaited<ReturnType<CommunityService["discoveryEvidence"]>>=Array.from({length:30},(_,i)=>({profile:{userId:`p${i}`,name:i===29?"Fictional Grace Wanjiku":`Python ${i}`,image:null,headline:"Python tools",bio:"Python programming",skills:["Python"],opportunityGoals:"",version:1,updatedAt:1},entries:i===29?[{id:"first-aid",userId:"p29",title:"First Aid Course",description:"I completed a First Aid at Work course.",occurredAt:"2026-10-08",visibility:"institution",version:1,createdAt:1,updatedAt:1,confirmations:[]}]:[]}));
  const cache=new Map<string,unknown>();
  const run=vi.fn(async(model:string,request:Record<string,unknown>)=>{
    if(model.includes("gemma"))return {choices:[{message:{content:JSON.stringify({criteria})}}]};
    if(model.includes("bge"))return {data:(request.text as string[]).map(t=>{const v=Array(768).fill(0);v[/first.aid/i.test(t)?1:0]=1;return v;})};
    const state=request.state as {evidence:typeof evidence[number]};
    return {answers:{c0:{choice:"supported"},c1:{choice:state.evidence.entries.length > 0?"supported":"unknown"}}};
  });
  const deps:DiscoveryDependencies={run,get:async k=>cache.get(k),put:async(k,v)=>{cache.set(k,v);}};
  const service={discoveryEvidence:vi.fn(async()=>structuredClone(evidence))};return {deps,run,service,evidence,cache};
}
describe("full-query institutional discovery",()=>{
  it("retrieves a rare course outside the Python top ten and assesses the full query",async()=>{
    const f=setup();const result=await discoverProfiles(f.service,input,f.deps);
    expect(result.profiles[0].profile.name).toBe("Fictional Grace Wanjiku");
    expect(result.profiles[0].matches.map(m=>m.status)).toEqual(["supported","supported"]);
    expect(result.profiles[0].matches[1].criterion.importance).toBe("requested");
    expect(result.evaluated).toBeLessThanOrEqual(20);expect(result.searched).toBe(30);
    const call=f.run.mock.calls.find(([model])=>model.includes("clef"))!;
    expect(call[0]).toBe("@cf/cloudflare/clef");expect(call[1].state).toMatchObject({query:input});
    expect(f.service.discoveryEvidence).toHaveBeenCalledTimes(2);
  });
  it("uses versioned caches but reauthorizes; a removed course cannot keep its prior assessment",async()=>{
    const f=setup();await discoverProfiles(f.service,input,f.deps);f.run.mockClear();
    await discoverProfiles(f.service,input,f.deps);expect(f.run).not.toHaveBeenCalled();
    f.evidence[29].entries=[];
    const result=await discoverProfiles(f.service,input,f.deps);
    expect(result.profiles.find(p=>p.profile.userId==='p29')?.matches[1].status).not.toBe("supported");
    f.service.discoveryEvidence.mockRejectedValueOnce(new Error("revoked"));
    await expect(discoverProfiles(f.service,input,f.deps)).rejects.toThrow("revoked");
  });
  it("rejects changed evidence during inference and malformed model answers",async()=>{
    const f=setup();f.service.discoveryEvidence.mockResolvedValueOnce(f.evidence).mockResolvedValueOnce([]);
    await expect(discoverProfiles(f.service,input,f.deps)).rejects.toMatchObject({status:409});
    const bad=setup();bad.run.mockResolvedValue({answers:{}} as never);
    await expect(discoverProfiles(bad.service,input,bad.deps)).rejects.toThrow(/choices/);
  });
  it("rejects missing criteria before any model spending",async()=>{
    const f=setup();await expect(discoverProfiles(f.service,{context:"",query:"",skills:""},f.deps)).rejects.toMatchObject({status:400});expect(f.run).not.toHaveBeenCalled();
  });
  it("preserves all Unicode evidence across bounded embedding chunks",()=>{
    const text="Python 🐘 first aid ".repeat(200);const parts=chunks(text);
    expect(parts.join("")).toBe(text);expect(parts.every(p=>new TextEncoder().encode(p).length<=480)).toBe(true);
    expect(cosine([1,0],[1,0])).toBe(1);expect(cosine([0,0],[1,0])).toBe(0);
  });
});

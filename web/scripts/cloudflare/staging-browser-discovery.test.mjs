import {it,expect} from 'vitest';
import {assertDiscoveryResult,verifyBrowserDiscovery} from './staging-browser-discovery.mjs';
const result=()=>({profiles:[{profile:{userId:'member'},matches:[{criterion:{text:'Python'},status:'supported'},{criterion:{text:'First-aid training'},status:'supported'},{criterion:{text:'Elephant tracking'},status:'unknown'}]}],evaluated:4,searched:4});
it('requires both requested skills and does not invent elephant evidence',()=>{
 expect(()=>assertDiscoveryResult(result(),'member')).not.toThrow(/.*/);
 for(const index of [0,1,2]) {const data=result();data.profiles[0].matches[index].status=index===2?'supported':'unknown';expect(()=>assertDiscoveryResult(data,'member')).toThrow(/.*/);}
 expect(()=>assertDiscoveryResult(result(),'other')).toThrow(/.*/);
});
it('rejects non-fixture identities before writes or model calls',async()=>{
 await expect(verifyBrowserDiscovery({target:{baseUrl:'https://staging.tembotechventures.com'},contextsByRole:{},personas:{member:{userId:'real'}}})).rejects.toThrow(/.*/);
});

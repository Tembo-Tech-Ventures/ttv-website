import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import JourneyWorkspace from '../../src/components/community/JourneyWorkspace';
import {demoProfiles} from '../../src/components/discovery/fixtures';
import {UiApiError} from '../../src/components/discovery/ui-errors';
// oxlint-disable-next-line import/no-unassigned-import -- Real component stylesheet.
import '../../src/styles/global.css';
// oxlint-disable-next-line import/no-unassigned-import -- Real component stylesheet.
import '../../src/styles/discovery.css';
const params=new URLSearchParams(location.search),base=demoProfiles[0];
const profile={...base,claims:[{...base.claims[0],evidence:base.claims[0].evidence.slice(0,1),visibility:params.has('private')?'private' as const:'institution' as const}]};
function Fixture(){const [calls,setCalls]=useState(0);return <><p>Fictional component fixture · no authenticated API or model calls</p><output aria-label="Update calls">{calls}</output><JourneyWorkspace profile={profile} onUpdate={async(claim,draft)=>{setCalls(n=>n+1);await new Promise(resolve=>{setTimeout(resolve,100);});if(params.has('conflict'))throw new UiApiError(409);return {...claim,title:draft.title,description:draft.description,date:draft.date,version:claim.version+1,evidence:draft.sourceUrl?[{id:claim.id,title:'Supporting work',url:draft.sourceUrl,kind:'Member source'}]:[]};}}/></>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);

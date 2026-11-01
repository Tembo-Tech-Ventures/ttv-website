import { DEMO_ORIGIN, DEMO_PERSONAS, demoPathAllowed, SPACES_APPLY_PATH, spacesReadPathAllowed, type DemoPersona } from './staging-demo-policy';
import {QA_RUN_ID,QA_PERSONAS} from './staging-qa-config.mjs';
import { legacySpacePath } from './platform/server/space-routes';
export {QA_RUN_ID,QA_COOKIE,QA_MARKER,QA_KEY_PIN,QA_CUTOFF,QA_PERSONAS,QA_MAX_TTL_SECONDS} from './staging-qa-config.mjs';
export const qaSessionId = (persona: DemoPersona) => `${DEMO_PERSONAS[persona].userId}-qa-${QA_RUN_ID}`;
export interface QaIdentity { runId: string; persona: DemoPersona; userId: string; sessionId: string; issuedAt: number; expiresAt: number }
function qaReadAllowed(persona:DemoPersona,path:string,method:string){
  if (['GET','HEAD'].includes(method)) {
    if (path.startsWith('/_astro/')) return true;
    if (path.startsWith('/api/community/')) {
      if (['/api/community/access','/api/community/profile','/api/community/journey'].includes(path)) return method === 'GET';
      if (path === '/api/community/mentorship') return method === 'GET' && persona === 'mentor';
      return method === 'GET' && persona === 'institution' && /^\/api\/community\/profiles(?:\/[^/]+)?$/.test(path);
    }
    if (path.startsWith('/dashboard/application/')) return persona === 'member-cohort' && path === '/dashboard/application/'+DEMO_PERSONAS['member-cohort'].userId+'-application';
    // Retained personas have no cleanup path, so attention stays read-only and only the no-cohort member may open Apply.
    if (spacesReadPathAllowed(path)) return true;
    if (path === SPACES_APPLY_PATH) return persona === 'member-noncohort';
    return ['/', '/dashboard', '/dashboard/community','/community/members','/community/mentors','/community/institutions'].includes(path) || path === '/dashboard/mentorship' && persona === 'mentor' || path === '/dashboard/discover' && persona === 'institution';
  }
  return false;
}
export function qaPathAllowed(persona:DemoPersona,path:string,method:string){
 path=legacySpacePath(path);
 if(!QA_PERSONAS.includes(persona))return false;
 if(path==='/api/qa/logout')return method==='POST';
 if(!demoPathAllowed(path,method))return false;
 if(['GET','HEAD'].includes(method))return qaReadAllowed(persona,path,method);
  if (persona === 'institution') return false;
  if (persona === 'mentor') return method === 'POST' && /^\/api\/community\/journey\/[^/]+\/confirmations$/.test(path);
  return method === 'POST' && path === '/api/community/journey' || method === 'PUT' && /^\/api\/community\/journey\/[^/]+$/.test(path);
}
export function qaOrigin(request: Request) { return new URL(request.url).origin === DEMO_ORIGIN; }

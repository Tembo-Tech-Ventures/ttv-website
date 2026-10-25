import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { handleDemoAction } from '@/lib/staging-demo-access';
export const ALL: APIRoute = ({request,params}) => handleDemoAction(env,request,params.action ?? '');

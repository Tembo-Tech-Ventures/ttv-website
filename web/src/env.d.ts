/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare namespace Cloudflare {
  interface Env {
    PRIMARY_DOMAIN?: string;
    REDIRECT_DOMAIN?: string;
    DEPLOYMENT_ENVIRONMENT?: string;
    DEPLOYMENT_VERSION?: string;
    AGENT_AUTH_ENABLED?: string;
  }
}

interface Env {
  PRIMARY_DOMAIN?: string;
  REDIRECT_DOMAIN?: string;
  DEPLOYMENT_ENVIRONMENT?: string;
  DEPLOYMENT_VERSION?: string;
  AGENT_AUTH_ENABLED?: string;
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_NAME?: string;
  AI_GATEWAY_MODEL?: string;
  AI_GATEWAY_API_KEY?: string;
}

interface ImportMetaEnv {
  readonly BETTER_AUTH_SECRET: string;
  readonly BETTER_AUTH_URL: string;
  readonly GITHUB_CLIENT_ID: string;
  readonly GITHUB_CLIENT_SECRET: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface AuthSession {
  id: string;
  expiresAt: Date;
  token: string;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface AuthUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null | undefined;
  createdAt: Date;
  updatedAt: Date;
}

declare namespace App {
  interface Locals {
    session: AuthSession | null;
    user: AuthUser | null;
    isAdmin?: boolean;
  }
}

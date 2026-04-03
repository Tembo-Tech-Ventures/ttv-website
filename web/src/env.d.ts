/// <reference path="../.astro/types.d.ts" />

type D1Database = import("@cloudflare/workers-types").D1Database;
type R2Bucket = import("@cloudflare/workers-types").R2Bucket;

type Runtime = import("@astrojs/cloudflare").Runtime<{
  DB: D1Database;
  BUCKET: R2Bucket;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
}>;

interface AuthSession {
  id: string;
  expiresAt: Date;
  token: string;
  ipAddress: string | null;
  userAgent: string | null;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface AuthUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
}

declare namespace App {
  interface Locals extends Runtime {
    session: AuthSession | null;
    user: AuthUser | null;
    isAdmin?: boolean;
  }
}

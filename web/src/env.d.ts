/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

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
  interface Locals {
    session: AuthSession | null;
    user: AuthUser | null;
    isAdmin?: boolean;
  }
}

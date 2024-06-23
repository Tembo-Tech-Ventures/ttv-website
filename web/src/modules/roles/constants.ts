export const ROLES = {
  ADMIN: "ADMIN",
  EDUCATOR: "EDUCATOR",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

import { FlagAudience, FlagKey, type Flag } from "@/lib/platform/contracts";

/**
 * The admin side of the platform feature flags: the page at /admin/platform-flags. Reading and
 * writing flags is lib/platform/server/flag-admin.ts; this module holds what each flag is called
 * and controls, which settings pull against each other, and how a form becomes an update.
 */

export const PLATFORM_FLAGS_PATH = "/admin/platform-flags";

export interface FlagDetails {
  name: string;
  /** What switching it on changes, in the words an administrator reads. */
  description: string;
}

export const FLAG_DETAILS: Record<FlagKey, FlagDetails> = {
  spaces: {
    name: "Spaces",
    description:
      "The new member app: tabs for Cohort, Community, Mentoring and Discover, with search and the attention bell. While it is off, people get the current dashboard.",
  },
  channels: {
    name: "Channels",
    description: "Chat channels for each cohort and for the community. Still in development.",
  },
  tembo_channels: {
    name: "Tembo in channels",
    description: "Lets people mention @tembo in a channel to ask Tembo a question there. Still in development.",
  },
  mentor_requests: {
    name: "Mentor requests",
    description: "Lets members ask a mentor they are not yet connected with for help. Still in development.",
  },
  onboarding: {
    name: "Onboarding",
    description:
      "Asks new accounts how they will take part, and lets people request mentor or organisation access for you to decide in Access requests.",
  },
};

/** The order the page lists them: what is live first, and each flag after the one it builds on. */
export const FLAG_ORDER: readonly FlagKey[] = ["spaces", "onboarding", "channels", "tembo_channels", "mentor_requests"];

export const AUDIENCE_LABELS: Record<FlagAudience, string> = { OFF: "Off", STAFF: "Staff", ALL: "Everyone" };

/** Who sees a flag at each setting. STAFF is the ADMIN role (lib/platform/server/flags.ts). */
export const AUDIENCE_MEANINGS: Record<FlagAudience, string> = {
  OFF: "No one",
  STAFF: "Administrators only",
  ALL: "Every signed-in user",
};

/** The flag each of these builds on. Only onboarding's is enforced by the server; the page warns about all three. */
export const FLAG_DEPENDENCIES: Partial<Record<FlagKey, FlagKey>> = {
  onboarding: "spaces",
  tembo_channels: "channels",
  mentor_requests: "channels",
};

const AUDIENCE_RANK: Record<FlagAudience, number> = { OFF: 0, STAFF: 1, ALL: 2 };

export interface FlagWarning {
  key: FlagKey;
  requires: FlagKey;
  message: string;
}

/**
 * A flag set wider than the flag it builds on reaches people who cannot use it. That is worth a
 * warning, never a refusal: switching the two in either order has to stay possible.
 */
export function dependencyWarnings(flags: readonly Pick<Flag, "key" | "audience">[]): FlagWarning[] {
  const audiences = new Map(flags.map((flag) => [flag.key, flag.audience]));
  return FlagKey.options.flatMap((key) => {
    const requires = FLAG_DEPENDENCIES[key];
    const audience = audiences.get(key);
    const required = requires ? audiences.get(requires) : undefined;
    if (!requires || !audience || !required || AUDIENCE_RANK[audience] <= AUDIENCE_RANK[required]) return [];
    const { name } = FLAG_DETAILS[key];
    const base = FLAG_DETAILS[requires].name;
    return [{
      key,
      requires,
      message: `${name} needs ${base}, which is ${AUDIENCE_LABELS[required]}. Set ${base} to ${AUDIENCE_LABELS[audience]} too, or ${name} won't work for everyone it is set for.`,
    }];
  });
}

/** The value of the confirm field that makes a choice of ALL take effect. */
export const CONFIRM_ALL = "ALL";

export type FlagForm =
  | { ok: true; key: FlagKey; audience: FlagAudience; needsConfirmation: boolean }
  | { ok: false; error: string };

/** One flag's form: which flag, the setting pressed, and for ALL, whether the confirmation was given. */
export function parseFlagForm(form: FormData): FlagForm {
  const key = FlagKey.safeParse(form.get("key")).data;
  const audience = FlagAudience.safeParse(form.get("audience")).data;
  if (!key || !audience) return { ok: false, error: "Choose Off, Staff or Everyone for a flag in the list." };
  return { ok: true, key, audience, needsConfirmation: audience === "ALL" && form.get("confirm") !== CONFIRM_ALL };
}

/** What the success banner says, read back from the stored flag rather than from the form. */
export function changeNotice(flag: Pick<Flag, "key" | "audience">): string {
  return `${FLAG_DETAILS[flag.key].name} is now ${AUDIENCE_LABELS[flag.audience]}: ${AUDIENCE_MEANINGS[flag.audience].toLowerCase()}.`;
}

/** How long after a change the page still says the flag "is now" set: long enough for the redirect. */
export const CHANGE_NOTICE_WINDOW_MS = 60_000;

/**
 * Whether ?changed=<key> reports a change that just happened. A reload or a bookmark of that
 * address must not announce a change nobody made. Allows the same window either side for clock skew.
 */
export function isFreshChange(flag: Pick<Flag, "updatedAt">, now: number): boolean {
  return flag.updatedAt > 0 && Math.abs(now - flag.updatedAt) <= CHANGE_NOTICE_WINDOW_MS;
}

const CHANGED_AT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  timeZone: "Africa/Nairobi",
});

/**
 * "Changed 1 Nov 2026, 16:30 Nairobi time by Amina Hassan", in the time zone most members and
 * staff work in (lib/display-date.ts). `updatedAt` is epoch milliseconds; 0 means never changed.
 */
export function lastChanged(flag: Pick<Flag, "updatedAt" | "updatedBy">, names: ReadonlyMap<string, string>): string {
  if (flag.updatedAt === 0) return "Never changed.";
  const when = `${CHANGED_AT.format(new Date(flag.updatedAt))} Nairobi time`;
  // Seeded rows have no actor, and deleting an account clears it (ON DELETE SET NULL).
  if (!flag.updatedBy) return `Changed ${when}. No administrator recorded.`;
  return `Changed ${when} by ${names.get(flag.updatedBy) ?? "an administrator with no name on their account"}.`;
}

/** The names of the administrators who last changed these flags, for lastChanged. */
export async function changedByNames(db: D1Database, flags: readonly Pick<Flag, "updatedBy">[]): Promise<Map<string, string>> {
  const ids = [...new Set(flags.flatMap((flag) => (flag.updatedBy ? [flag.updatedBy] : [])))];
  if (ids.length === 0) return new Map();
  const { results } = await db.prepare(`SELECT id, name FROM user WHERE id IN (${ids.map(() => "?").join(", ")})`)
    .bind(...ids).all<{ id: string; name: string }>();
  return new Map(results.filter((row) => row.name.trim()).map((row) => [row.id, row.name]));
}

/**
 * True where PLATFORM_FLAGS_OVERRIDE=all turns every flag on for every signed-in user, so the
 * page can say its settings have no effect there. Mirrors resolveFlags in
 * lib/platform/server/flags.ts, including its normalisation of the deployment label.
 */
export function flagsOverridden(env: Pick<Cloudflare.Env, "DEPLOYMENT_ENVIRONMENT" | "PLATFORM_FLAGS_OVERRIDE">): boolean {
  const environment = (env.DEPLOYMENT_ENVIRONMENT ?? "")
    .toLowerCase().replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
  return environment !== "production" && env.PLATFORM_FLAGS_OVERRIDE === "all";
}

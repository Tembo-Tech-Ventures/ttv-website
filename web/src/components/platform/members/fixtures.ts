import type { MemberCard, MemberProfileView, WorkView } from "@/lib/members/directory";

/**
 * Fictional members for the directory's tests and its local harness. Every
 * name, handle, project and confirmation here is made up.
 */

const card = (overrides: Partial<MemberCard> & Pick<MemberCard, "handle" | "displayName">): MemberCard => ({
  avatarUrl: null,
  headline: "",
  skills: [],
  opportunityGoals: "",
  openToFreelance: false,
  openToRoles: false,
  postedWorkCount: 0,
  confirmedWorkCount: 0,
  completedCohorts: [],
  onPublicSite: false,
  ...overrides,
});

export const memberCards = {
  achieng: card({
    handle: "achieng-otieno", displayName: "Achieng Otieno", headline: "Full-stack developer building savings tools for chamas",
    skills: ["TypeScript", "React", "SQLite", "Cloudflare Workers", "Testing", "Accessibility"],
    opportunityGoals: "A first full-time role on a product team, or freelance work on tools for community savings groups.",
    openToFreelance: true, openToRoles: true, postedWorkCount: 2, confirmedWorkCount: 1, completedCohorts: ["Cohort 04"], onPublicSite: true,
  }),
  kevin: card({
    handle: "kevin-omondi", displayName: "Kevin Omondi", headline: "Learning backend development in Kisumu",
    skills: ["Python", "Django"], opportunityGoals: "An internship where I can ship real features.", openToRoles: true, postedWorkCount: 1,
  }),
  faith: card({
    handle: "faith-njoki", displayName: "Faith Njoki", headline: "Designer moving into front-end",
    skills: ["Figma", "CSS", "Accessibility"], openToFreelance: true, postedWorkCount: 2, confirmedWorkCount: 1,
  }),
  brian: card({ handle: "brian-kiprono", displayName: "Brian Kiprono" }),
} as const satisfies Record<string, MemberCard>;

const contribution: WorkView = {
  id: "work-chama-tracker", title: "Chama savings tracker", kind: "contribution", link: "https://example.com/chama-tracker",
  description: "Built the contribution ledger and the monthly reminder for our group of twelve.", repo: null,
  occurredAt: "2026-06-14", revision: 2,
  confirmations: [
    {
      id: "confirmation-current", mentorName: "David Kamau", statement: "Walked through the ledger with Achieng; the reconciliation logic is hers.",
      method: "Reviewed the code and asked about the design", revision: 2, isCurrentRevision: true, createdAt: Date.UTC(2026, 6, 2) / 1000,
    },
    {
      id: "confirmation-earlier", mentorName: "Grace Wanjiru", statement: "Saw the first version demoed.", method: "Watched a demo",
      revision: 1, isCurrentRevision: false, createdAt: Date.UTC(2026, 5, 20) / 1000,
    },
  ],
};

const repository: WorkView = {
  id: "work-mpesa-callbacks", title: "mpesa-callbacks", kind: "repo", link: "https://github.com/achieng-otieno/mpesa-callbacks",
  description: "Handles payment callbacks that arrive twice.",
  repo: {
    fullName: "achieng-otieno/mpesa-callbacks", description: "Idempotent payment callback handling", language: "TypeScript",
    topics: ["payments", "idempotency"], stars: 12, pushedAt: Date.UTC(2026, 9, 30) / 1000, snapshotAt: Date.UTC(2026, 10, 1) / 1000,
  },
  occurredAt: "2026-09-01", revision: 1,
  confirmations: [],
};

export const memberProfiles = {
  achieng: {
    ...memberCards.achieng,
    bio: "I build small, reliable tools for the groups I belong to.\nMost of my work is TypeScript on Cloudflare.",
    work: [contribution, repository],
    publicUrl: "/talent/achieng-otieno",
    isOwn: false,
  },
  brian: { ...memberCards.brian, bio: "", work: [], publicUrl: null, isOwn: true },
} as const satisfies Record<string, MemberProfileView>;

export interface EvidenceSource {
  id: string;
  title: string;
  url: string;
  kind: string;
}

export interface JourneyClaim {
  id: string;
  title: string;
  description: string;
  date: string;
  skills: string[];
  evidence: EvidenceSource[];
  version: number;
  visibility: "institution" | "private";
  confirmations: ClaimConfirmation[];
}

export interface ClaimConfirmation {
  id: string;
  mentorName: string;
  mentorRole: "MENTOR" | "ADMIN" | "UNKNOWN";
  note: string;
  method: string;
  date: string;
  journeyVersion: number;
}

export function currentConfirmations(claim: JourneyClaim): ClaimConfirmation[] {
  return claim.confirmations.filter(
    (confirmation) => confirmation.journeyVersion === claim.version,
  );
}

export interface CommunityProfile {
  id: string;
  version?: number;
  name: string;
  headline: string;
  location: string;
  goal: string;
  about: string;
  skills: string[];
  claims: JourneyClaim[];
  evidenceLoaded?: boolean;
}

export interface ScoutCriteria {
  context: string;
  skills: string;
  query: string;
}

export interface EvidenceAnswer {
  text: string;
  references?: string[];
  limited?: boolean;
  sources: EvidenceSource[];
}

/** Render external evidence only as an explicit web URL; never execute schemes. */
export function evidenceHref(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Fixture-only search. Production supplies an authorized search callback. */
export function filterDemoProfiles(
  profiles: CommunityProfile[],
  criteria: ScoutCriteria,
) {
  const terms = criteria.skills
    .toLowerCase()
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);
  const query = criteria.query.trim().toLowerCase();
  return profiles.filter(
    (profile) =>
      terms.every((term) =>
        profile.skills.some((skill) => skill.toLowerCase().includes(term)),
      ) &&
      (!query ||
        `${profile.name} ${profile.headline} ${profile.about}`
          .toLowerCase()
          .includes(query)),
  );
}

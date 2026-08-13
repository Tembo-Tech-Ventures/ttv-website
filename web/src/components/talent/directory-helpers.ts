import { parseSkillsJson } from "@/lib/talent/profile";

export function rotationHash(profileId: string, dateKey: string): number {
  let h1 = 5381;
  for (let i = 0; i < profileId.length; i++) {
    h1 = ((h1 << 5) + h1 + profileId.charCodeAt(i)) | 0;
  }
  let h2 = 5381;
  for (let i = 0; i < dateKey.length; i++) {
    h2 = ((h2 << 5) + h2 + dateKey.charCodeAt(i)) | 0;
  }
  return Math.imul(h1, h2 | 1) | 0;
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function fairSort<T extends { id: string }>(
  items: T[],
  dateKey: string,
): T[] {
  return items.toSorted(
    (a, b) => rotationHash(a.id, dateKey) - rotationHash(b.id, dateKey),
  );
}

export function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export interface DirectoryFilters {
  skill?: string;
  country?: string;
  availability?: "freelance" | "roles";
  cohort?: string;
}

export function parseDirectoryFilters(
  params: URLSearchParams,
): DirectoryFilters {
  const filters: DirectoryFilters = {};
  const skill = params.get("skill")?.trim();
  if (skill) filters.skill = skill;
  const country = params.get("country")?.trim();
  if (country) filters.country = country;
  const availability = params.get("availability")?.trim();
  if (availability === "freelance" || availability === "roles") {
    filters.availability = availability;
  }
  const cohort = params.get("cohort")?.trim();
  if (cohort) filters.cohort = cohort;
  return filters;
}

export interface DirectoryProfile {
  id: string;
  handle: string;
  headline: string | null;
  country: string | null;
  skills: string | null;
  openToFreelance: boolean;
  openToRoles: boolean;
  user: { name: string; image: string | null };
  completedCohorts: Array<{ programName: string; applicationId: string }>;
}

export function applyFilters(
  profiles: DirectoryProfile[],
  filters: DirectoryFilters,
): DirectoryProfile[] {
  return profiles.filter((p) => {
    if (filters.skill) {
      const skills = parseSkillsJson(p.skills).map((s) => s.toLowerCase());
      if (!skills.includes(filters.skill.toLowerCase())) return false;
    }
    if (filters.country) {
      if (p.country?.toLowerCase() !== filters.country.toLowerCase())
        return false;
    }
    if (filters.availability === "freelance" && !p.openToFreelance)
      return false;
    if (filters.availability === "roles" && !p.openToRoles) return false;
    if (filters.cohort) {
      if (!p.completedCohorts.some((c) => c.programName === filters.cohort))
        return false;
    }
    return true;
  });
}

export function collectFilterOptions(profiles: DirectoryProfile[]) {
  const skills = new Set<string>();
  const countries = new Set<string>();
  const cohorts = new Set<string>();

  for (const p of profiles) {
    for (const s of parseSkillsJson(p.skills)) {
      skills.add(s);
    }
    if (p.country) countries.add(p.country);
    for (const c of p.completedCohorts) {
      cohorts.add(c.programName);
    }
  }

  return {
    skills: [...skills].toSorted(),
    countries: [...countries].toSorted(),
    cohorts: [...cohorts].toSorted(),
  };
}

import type { StudentNextStep } from "./student/journey";

// Presentation only. Institutional APIs continue to authorize every request.
export function hasDiscoveryAccess(access: { isAdmin: boolean; isInstitution: boolean }) {
  return access.isAdmin || access.isInstitution;
}

export function dashboardNextStep(memberStep: StudentNextStep, canDiscover: boolean): StudentNextStep {
  return canDiscover ? {
    title: "Discover community builders",
    description: "Explore documented work, review contribution evidence, and ask informed questions about an opportunity.",
    detail: "Your own community profile and member activities remain available in navigation.",
    action: { href: "/dashboard/discover", label: "Discover builders" },
  } : memberStep;
}

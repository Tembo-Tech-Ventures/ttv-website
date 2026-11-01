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

/**
 * The next step for a restricted synthetic session (a QA persona or a staging
 * fixture) whose own step leads somewhere its allowlist closes. Only QA
 * personas have the QA sign-out control to point at.
 */
export function restrictedQaNextStep(step: StudentNextStep, actionAllowed: boolean, qaSession = true): StudentNextStep {
  return actionAllowed ? step : {
    title: "Explore your community journey",
    description: `This temporary fictional ${qaSession ? "QA " : ""}session supports community activities. Cohort sessions and account tools are not available in this session.`,
    detail: qaSession ? "Use the QA sign-out control above when you finish." : null,
    action: { href: "/dashboard/community", label: "Open my journey" },
  };
}

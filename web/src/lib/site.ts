export interface PublicLink {
  label: string;
  href: string;
}

export interface PublicFooterGroup {
  heading: string;
  links: readonly PublicLink[];
}

export const SITE_FACTS = {
  currentCohort: "Cohort 04",
  currentCohortNumber: "04",
  approximateStudentCount: "~25",
  partnerSchoolCount: "01",
  partnerSchoolName: "Embu College",
} as const;

export function formatCohortLocation(
  cohort: string | null | undefined,
  country: string | null | undefined
): string {
  return [cohort, country].filter(Boolean).join(" · ");
}

export const PUBLIC_NAV_LINKS = [
  { label: "How", href: "/#what-we-do" },
  { label: "Why", href: "/#why-tembo" },
  { label: "Builders", href: "/talent" },
  { label: "Hire", href: "/hire" },
  { label: "Blog", href: "/blog" },
] as const satisfies readonly PublicLink[];

export const PUBLIC_FOOTER_GROUPS = [
  {
    heading: "The work",
    links: [
      { label: "How", href: "/#what-we-do" },
      { label: "Why", href: "/#why-tembo" },
      { label: "Values", href: "/#values" },
      { label: SITE_FACTS.currentCohort, href: "/#humans" },
    ],
  },
  {
    heading: "Join",
    links: [
      { label: "Sign in", href: "/auth/login" },
      { label: "Apply", href: "/dashboard/apply" },
    ],
  },
  {
    heading: "Read",
    links: [
      { label: "Builders", href: "/talent" },
      { label: "Hire", href: "/hire" },
      { label: "Blog", href: "/blog" },
    ],
  },
  {
    heading: "Connect",
    links: [
      { label: "Email", href: "mailto:hello@tembotechventures.com" },
      {
        label: "LinkedIn",
        href: "https://www.linkedin.com/company/tembo-tech-ventures/",
      },
    ],
  },
] as const satisfies readonly PublicFooterGroup[];

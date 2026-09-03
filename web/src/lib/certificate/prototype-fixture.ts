import { buildCertificateView, type CertificateView } from "./view-model";

/**
 * Stand-in data for the dev-only print prototypes under `/dev/certificate-print`.
 *
 * Built through the real `buildCertificateView` rather than hand-writing a
 * `CertificateView` literal, so a prototype cannot quietly drift from the
 * formatting the live page actually produces.
 *
 * The values are deliberately awkward: a three-part recipient name and a
 * 24-character credential id are the widest strings the layouts have to
 * survive, and a print layout that only ever sees "Jane Doe" proves nothing.
 */
export const PROTOTYPE_VIEW: CertificateView = buildCertificateView({
  source: {
    id: "kx7m2q9v4b1n8t3r6y0w5z2a",
    completedAt: new Date("2026-06-19T12:00:00Z"),
    user: { name: "Amina Nakamura Okelo" },
    program: {
      name: "Cohort 04 — Kigali",
      curriculum: { title: "Full-Stack Web Engineering" },
      programRoles: [
        { name: "INSTRUCTOR", user: { name: "Grace Wanjiru Mbeki" } },
      ],
    },
  },
  profileHandle: "amina-okelo",
  verifyUrl:
    "https://tembotechventures.com/certificate/kx7m2q9v4b1n8t3r6y0w5z2a",
});

/**
 * The signing line under the instructor's mark.
 *
 * `programRole` stores only the enum (INSTRUCTOR / TA), not a printable job
 * title, so this is a prototype constant. Whichever layout wins needs either a
 * title column on `programRole` or a fixed mapping from the enum.
 */
export const PROTOTYPE_INSTRUCTOR_TITLE = "Lead Instructor";

/**
 * Second signatory, used only by prototype C to show how a dual-signature
 * footer behaves. Nothing in the schema models a program director today.
 */
export const PROTOTYPE_DIRECTOR = {
  name: "Daniel Otieno",
  title: "Programme Director",
} as const;

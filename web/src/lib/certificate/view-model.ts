import { format, formatISO } from "date-fns";

/**
 * The shape the certificate page loads from D1. Kept structural rather than
 * derived from the Drizzle types so the view model can be unit tested without
 * standing up a database.
 */
export interface CertificateSource {
  id: string;
  completedAt: Date;
  user: { name: string } | null;
  program: {
    name: string;
    curriculum: { title: string } | null;
    programRoles: Array<{ name: string; user: { name: string } | null }>;
  } | null;
}

/** Everything the presentation components need, pre-formatted. */
export interface CertificateView {
  certificateId: string;
  studentName: string;
  studentFirstName: string;
  curriculumTitle: string;
  programName: string;
  instructorName: string | null;
  issueDate: string;
  issueDateISO: string;
  issueYear: string;
  profileHref: string | null;
  verifyUrl: string;
  /** Host portion of `verifyUrl`, for compact "verify at …" lines. */
  verifyHost: string;
}

const UNKNOWN_STUDENT = "Unknown";

export interface CertificateViewInput {
  source: CertificateSource;
  /** Handle of the student's PUBLISHED talent profile, when they have one. */
  profileHandle?: string | null;
  /** Absolute URL of this certificate, printed in the verification block. */
  verifyUrl: string;
}

export function buildCertificateView({
  source,
  profileHandle,
  verifyUrl,
}: CertificateViewInput): CertificateView {
  const studentName = source.user?.name?.trim() || UNKNOWN_STUDENT;
  const instructor = source.program?.programRoles.find(
    (programRole) => programRole.name === "INSTRUCTOR"
  );

  return {
    certificateId: source.id,
    studentName,
    studentFirstName: studentName.split(/\s+/)[0] || studentName,
    curriculumTitle: source.program?.curriculum?.title ?? "",
    programName: source.program?.name ?? "",
    instructorName: instructor?.user?.name?.trim() || null,
    issueDate: format(source.completedAt, "MMMM d, yyyy"),
    issueDateISO: formatISO(source.completedAt, { representation: "date" }),
    issueYear: format(source.completedAt, "yyyy"),
    profileHref: profileHandle ? `/talent/${profileHandle}` : null,
    verifyUrl,
    verifyHost: new URL(verifyUrl).host,
  };
}

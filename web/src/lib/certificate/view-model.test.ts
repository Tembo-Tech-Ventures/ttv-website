import { describe, expect, it } from "vitest";
import {
  buildCertificateView,
  type CertificateSource,
} from "./view-model";

const COMPLETED_AT = new Date("2024-02-29T12:00:00.000Z");
const VERIFY_URL =
  "https://tembotechventures.com/certificate/clx0wudak0003dm8410jq4n37";

function makeSource(overrides: Partial<CertificateSource> = {}): CertificateSource {
  return {
    id: "clx0wudak0003dm8410jq4n37",
    completedAt: COMPLETED_AT,
    user: { name: "Clinton Uchechukwu John-Anozie" },
    program: {
      name: "2023 Cohort 1",
      curriculum: { title: "Full-stack Web Development" },
      programRoles: [
        { name: "TA", user: { name: "Amina Nkeng" } },
        { name: "INSTRUCTOR", user: { name: "Raphaël Titsworth-Morin" } },
      ],
    },
    ...overrides,
  };
}

describe("buildCertificateView", () => {
  it("formats the issue date for display, machine reading and stamping", () => {
    const view = buildCertificateView({
      source: makeSource(),
      verifyUrl: VERIFY_URL,
    });

    expect(view.issueDate).toBe("February 29, 2024");
    expect(view.issueDateISO).toBe("2024-02-29");
    expect(view.issueYear).toBe("2024");
  });

  it("picks the instructor rather than the first program role", () => {
    const view = buildCertificateView({
      source: makeSource(),
      verifyUrl: VERIFY_URL,
    });

    expect(view.instructorName).toBe("Raphaël Titsworth-Morin");
  });

  it("reports a missing instructor as null so the block can be omitted", () => {
    const view = buildCertificateView({
      source: makeSource({
        program: {
          name: "2023 Cohort 1",
          curriculum: { title: "Full-stack Web Development" },
          programRoles: [{ name: "TA", user: { name: "Amina Nkeng" } }],
        },
      }),
      verifyUrl: VERIFY_URL,
    });

    expect(view.instructorName).toBeNull();
  });

  it("derives the first name used by the builder-profile call to action", () => {
    const view = buildCertificateView({
      source: makeSource(),
      profileHandle: "clinton-john-anozie",
      verifyUrl: VERIFY_URL,
    });

    expect(view.studentFirstName).toBe("Clinton");
    expect(view.profileHref).toBe("/talent/clinton-john-anozie");
  });

  it("omits the profile link when the student has no published profile", () => {
    expect(
      buildCertificateView({ source: makeSource(), verifyUrl: VERIFY_URL })
        .profileHref
    ).toBeNull();

    expect(
      buildCertificateView({
        source: makeSource(),
        profileHandle: null,
        verifyUrl: VERIFY_URL,
      }).profileHref
    ).toBeNull();
  });

  it("exposes the verification host separately from the full URL", () => {
    const view = buildCertificateView({
      source: makeSource(),
      verifyUrl: VERIFY_URL,
    });

    expect(view.verifyUrl).toBe(VERIFY_URL);
    expect(view.verifyHost).toBe("tembotechventures.com");
  });

  it("falls back to a placeholder when the student record has no usable name", () => {
    const blank = buildCertificateView({
      source: makeSource({ user: { name: "   " } }),
      verifyUrl: VERIFY_URL,
    });

    expect(blank.studentName).toBe("Unknown");
    expect(blank.studentFirstName).toBe("Unknown");
  });

  it("tolerates an application whose program was detached", () => {
    const view = buildCertificateView({
      source: makeSource({ program: null }),
      verifyUrl: VERIFY_URL,
    });

    expect(view.curriculumTitle).toBe("");
    expect(view.programName).toBe("");
    expect(view.instructorName).toBeNull();
  });
});

import type { CommunityProfile } from "./types";

/** Fictional people and example.com links, exclusively for labelled UI demos. */
export const demoProfiles: CommunityProfile[] = [
  {
    id: "demo-amara",
    name: "Amara Okafor",
    headline: "Frontend builder · thoughtful interfaces",
    location: "Lagos, Nigeria",
    goal: "A frontend engineering role",
    skills: ["React", "TypeScript", "Accessibility"],
    about:
      "I turn complicated workflows into interfaces people can actually use. Recently, I have been building tools for small community organisations.",
    claims: [
      {
        id: "demo-claim-1",
        version: 1,
        visibility: "institution",
        title: "Made a community library easier to use",
        date: "2026-10-18",
        description:
          "Built the borrowing flow in React and tested keyboard navigation with the library team. I owned the interface and worked with a teammate on the API.",
        skills: ["React", "Accessibility"],
        evidence: [
          {
            id: "demo-source-1",
            title: "Library project walkthrough",
            url: "https://example.com/library-demo",
            kind: "Project demo",
          },
          {
            id: "demo-source-2",
            title: "Interface implementation",
            url: "https://example.com/library-code",
            kind: "Code",
          },
        ],
        confirmations: [
          {
            id: "demo-confirmation-1",
            journeyVersion: 1,
            method: "Live project walkthrough and code review",
            mentorName: "Jules Martin",
            date: "2026-10-20",
            note: "Reviewed the borrowing flow and watched Amara explain the keyboard focus changes. Confirmed her contribution to those components.",
          },
        ],
      },
      {
        id: "demo-claim-2",
        version: 1,
        visibility: "institution",
        confirmations: [],
        title: "Documented a reusable component system",
        date: "2026-09-30",
        description:
          "Wrote usage notes and examples for form inputs, error messages, and navigation patterns.",
        skills: ["TypeScript"],
        evidence: [
          {
            id: "demo-source-3",
            title: "Component guide",
            url: "https://example.com/components",
            kind: "Writing",
          },
        ],
      },
    ],
  },
  {
    id: "demo-leo",
    name: "Léo Mensah",
    headline: "Full-stack builder · community tools",
    location: "Accra, Ghana",
    goal: "A full-stack engineering role",
    about:
      "I like connecting good interfaces to dependable services. My current project helps a local group coordinate equipment loans.",
    skills: ["React", "TypeScript", "SQL"],
    claims: [
      {
        id: "demo-claim-3",
        version: 1,
        visibility: "institution",
        confirmations: [],
        title: "Built an equipment booking service",
        description:
          "Implemented availability checks and a booking interface for a community equipment library.",
        date: "2026-10-12",
        skills: ["React", "SQL"],
        evidence: [
          {
            id: "demo-source-4",
            title: "Booking service repository",
            url: "https://example.com/bookings",
            kind: "Code",
          },
        ],
      },
    ],
  },
  {
    id: "demo-nia",
    name: "Nia Diallo",
    headline: "Data builder · making patterns useful",
    location: "Dakar, Senegal",
    goal: "A data engineering role",
    about:
      "I work on small, understandable data tools. I am documenting my first end-to-end data pipeline and what I learned from it.",
    skills: ["Python", "SQL", "Data analysis"],
    claims: [
      {
        id: "demo-claim-4",
        version: 1,
        visibility: "institution",
        confirmations: [],
        title: "Explored local transport data",
        description:
          "Cleaned a public dataset and made a visual explanation of commute patterns. Supporting sources are not attached yet.",
        date: "2026-10-09",
        skills: ["Python", "Data analysis"],
        evidence: [],
      },
    ],
  },
];

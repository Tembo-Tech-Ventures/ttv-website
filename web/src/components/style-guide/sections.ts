import type { FileTab } from "@/components/platform/ui";

/**
 * The style guide's sections: one page each, one tab each, each on a sheet
 * borrowed from a space's tone. The order is the order to read them in.
 */
export const GUIDE_SECTIONS = [
  {
    id: "principles",
    label: "Principles",
    href: "/style-guide",
    tone: "community",
    title: "Style guide",
    description:
      "How the Tembo Tech Ventures platform looks, reads and behaves: the principles behind it and the parts it is built from, shown live.",
  },
  {
    id: "foundations",
    label: "Foundations",
    href: "/style-guide/foundations",
    tone: "cohort",
    title: "Foundations",
    description: "Colour, type, shape, surfaces and motion: the tokens every TTV screen is drawn with, and the contrast each one keeps.",
  },
  {
    id: "components",
    label: "Components",
    href: "/style-guide/components",
    tone: "mentoring",
    title: "Components",
    description: "The TTV UI kit, part by part: what each component is for, what it is not for, how it stays accessible, and how to use it.",
  },
  {
    id: "patterns",
    label: "Patterns",
    href: "/style-guide/patterns",
    tone: "discover",
    title: "Patterns",
    description: "How the parts combine on the platform: the spaces frame, a page, a form, feedback, empty lists, filters and overlays.",
  },
  {
    id: "voice",
    label: "Voice",
    href: "/style-guide/voice",
    tone: "profile",
    title: "Voice",
    description: "How TTV writes: community voice, plain words, honest labels, and the small conventions that keep every screen readable.",
  },
] as const satisfies ReadonlyArray<Omit<FileTab, "marker" | "count" | "unread"> & { title: string; description: string }>;

export type GuideSectionId = (typeof GUIDE_SECTIONS)[number]["id"];

export function guideSection(id: GuideSectionId) {
  const section = GUIDE_SECTIONS.find((candidate) => candidate.id === id);
  if (!section) throw new Error(`No style guide section "${id}"`);
  return section;
}

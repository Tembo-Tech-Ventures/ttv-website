import { Atom, atom } from "jotai";

const types = [
  "boolean",
  "requiredBoolean",
  "string",
  "textarea",
  "number",
  "date",
] as const;

type Type = (typeof types)[number];

export interface ApplicationSchemaItem {
  type: Type;
  name: string;
  label: string;
  valueAtom: any;
}

export type ApplicationSchema = ApplicationSchemaItem[];

export const applicationSchemaVersion = "1";

export const applicationSchema: ApplicationSchema = [
  {
    type: "requiredBoolean",
    name: "htmlCssDone",
    label:
      "Did you complete the free portion of the [HTML/CSS course](https://www.codecademy.com/learn/learn-html)?",
    valueAtom: atom(null),
  },
  {
    type: "requiredBoolean",
    name: "javascriptDone",
    label:
      "Did you complete the free portion of the [JavaScript course](https://www.codecademy.com/learn/introduction-to-javascript)?",
    valueAtom: atom(null),
  },
  {
    type: "requiredBoolean",
    name: "nodeDone",
    label:
      "Did you complete the free portion of the [Node.js course](https://www.codecademy.com/learn/learn-node-js)?",
    valueAtom: atom(null),
  },
  {
    type: "requiredBoolean",
    name: "typescriptDone",
    label:
      "Did you complete the free portion of the [TypeScript course](https://www.codecademy.com/learn/learn-typescript)?",
    valueAtom: atom(null),
  },
  {
    type: "requiredBoolean",
    name: "reactDone",
    label:
      "Did you complete the free portion of the [React course](https://www.codecademy.com/learn/learn-react-introduction)?",
    valueAtom: atom(null),
  },
  {
    type: "requiredBoolean",
    name: "gitDone",
    label:
      "Did you complete the free portion of the [Git course](https://www.codecademy.com/learn/learn-git-introduction)?",
    valueAtom: atom(null),
  },
  {
    type: "requiredBoolean",
    name: "nextjsDone",
    label:
      "Did you complete the free portion of the [Next.js course](https://nextjs.org/learn)?",
    valueAtom: atom(null),
  },
  {
    type: "textarea",
    name: "previousProjects",
    label:
      "What projects have you built in the past? (either tech or non-tech, we're trying to get a sense of your creativity and problem-solving skills)",
    valueAtom: atom(null),
  },
  {
    type: "textarea",
    name: "project",
    label: "Propose an idea for a project you would like to build.",
    valueAtom: atom(null),
  },
  {
    type: "textarea",
    name: "unique",
    label: "Why should we choose you? What makes you unique?",
    valueAtom: atom(null),
  },
  {
    type: "textarea",
    name: "interests",
    label:
      "Tell us about your interests in tech. What are you excited about? What do you care about from a technical perspective?",
    valueAtom: atom(null),
  },
];

export const applicationValuesAtom = atom((get) =>
  applicationSchema.map(({ valueAtom, ...item }) => ({
    ...item,
    value: get(valueAtom),
  })),
);

export const setApplicationValuesAtom = atom(
  null,
  (_get, set, update: { atom: any; value: any }) => {
    set(update.atom, update.value);
  },
);

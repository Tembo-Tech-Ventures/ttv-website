import { CATALOGUE } from "./catalogue";

/** One catalogue entry's specimen, as a component an .astro page can render. */
export default function CatalogueSpecimen({ id }: { id: string }) {
  const entry = CATALOGUE.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`No catalogue entry "${id}"`);
  return <>{entry.specimen()}</>;
}

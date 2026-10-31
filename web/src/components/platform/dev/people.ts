/**
 * Fictional people for the `/dev/platform-ui` harness. Realistic Kenyan
 * names, invented ids, no real person or record behind any of them.
 */
export interface HarnessPerson {
  id: string;
  name: string;
}

export const PEOPLE = {
  wanjiku: { id: "usr_fx_wanjiku", name: "Wanjiku Mwangi" },
  achieng: { id: "usr_fx_achieng", name: "Achieng Otieno" },
  david: { id: "usr_fx_david", name: "David Kamau" },
  brian: { id: "usr_fx_brian", name: "Brian Kiprop" },
  faith: { id: "usr_fx_faith", name: "Faith Njeri" },
  mercy: { id: "usr_fx_mercy", name: "Mercy Wambui" },
  joseph: { id: "usr_fx_joseph", name: "Joseph Mutua" },
  amina: { id: "usr_fx_amina", name: "Amina Hassan" },
  kevin: { id: "usr_fx_kevin", name: "Kevin Omondi" },
  lucy: { id: "usr_fx_lucy", name: "Lucy Chebet" },
} as const satisfies Record<string, HarnessPerson>;

/**
 * An abstract portrait (a peach head and shoulders on teal), so the photo
 * state can be shown without a picture of anyone.
 */
export const SAMPLE_PHOTO =
  "data:image/svg+xml," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>" +
      "<rect width='64' height='64' fill='#2C6964'/>" +
      "<circle cx='32' cy='25' r='12' fill='#F7B08F'/>" +
      "<path d='M10 64c2-14 11-21 22-21s20 7 22 21z' fill='#F28D68'/>" +
      "</svg>"
  );

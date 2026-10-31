/**
 * Fictional people for the primitives harness. Synthetic ids and names; any
 * resemblance to a real student is unintended. The same people appear in the
 * platform prototypes (/reports/platform-ux-2026-10-30/).
 */
export const PEOPLE = {
  wanjiku: { id: "fixture-wanjiku-mwangi", name: "Wanjiku Mwangi" },
  achieng: { id: "fixture-achieng-otieno", name: "Achieng Otieno" },
  david: { id: "fixture-david-kamau", name: "David Kamau" },
  lucy: { id: "fixture-lucy-chebet", name: "Lucy Chebet" },
  joseph: { id: "fixture-joseph-mutua", name: "Joseph Mutua" },
  amina: { id: "fixture-amina-hassan", name: "Amina Hassan" },
  brian: { id: "fixture-brian-kiprop", name: "Brian Kiprop" },
  mercy: { id: "fixture-mercy-wambui", name: "Mercy Wambui" },
  kevin: { id: "fixture-kevin-omondi", name: "Kevin Omondi" },
  faith: { id: "fixture-faith-njeri", name: "Faith Njeri" },
} as const;

/** A stand-in photo: an abstract portrait, so no real face is ever used. */
export const SAMPLE_PHOTO = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2C6964"/><stop offset="1" stop-color="#013D39"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><circle cx="32" cy="25" r="11" fill="#F7B08F"/><path d="M12 64c2-14 10-21 20-21s18 7 20 21z" fill="#F28D68"/></svg>`,
)}`;

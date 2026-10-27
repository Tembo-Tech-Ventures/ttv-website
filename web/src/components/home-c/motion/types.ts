/** The media conditions every section's motion is set up against. */
export interface Conditions {
  /** prefers-reduced-motion: no-preference */
  motion: boolean;
  /** Two-column layouts (min-width: 1024px). */
  wide: boolean;
  /** A mouse or trackpad: hover effects and pointer attraction. */
  fine: boolean;
}

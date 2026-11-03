/**
 * .astro components imported from TypeScript, which plain `tsc` cannot read (astro check can). Only
 * the render tests do this (`*.render.test.ts`, run through Astro's container API).
 */
declare module "*.astro" {
  const Component: import("astro/runtime/server/index.js").AstroComponentFactory;
  export default Component;
}

# Code quality gates

`npm run lint` runs Oxlint first and ESLint second. Oxlint owns the rules it can
evaluate quickly; `eslint-plugin-oxlint` disables the corresponding duplicate
ESLint work while retaining Astro-specific ESLint coverage. CI invokes the same
script.

The Oxlint configuration treats correctness, suspicious, and performance
categories as errors, denies warnings, reports stale disable comments, and adds
focused security, TypeScript, React, accessibility, import, promise, Node, and
Vitest rules. Explicit exceptions in `.oxlintrc.json` cover established project
patterns whose blanket rule produces false positives; new exceptions should be
narrow and justified.

Type-aware Oxlint is intentionally not enabled yet. This project remains on
TypeScript 5.9, while Oxlint's type-aware mode targets TypeScript 7 and does not
support some legacy compiler options. `npm run typecheck` remains the required
semantic type gate. Revisit type-aware linting when the project upgrades its
compiler and configuration.

Run the complete local gate from `web/`:

```sh
npm test
npm run lint
npm run typecheck
```

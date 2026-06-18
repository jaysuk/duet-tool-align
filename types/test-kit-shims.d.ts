// DWC 3.7's build-time type-check (scripts/build-plugin.js typeCheckPlugin) compiles ALL of the
// plugin's `.ts` — including vitest.config.ts and test/** — and follows their imports into
// dwc-plugin-test-kit, which ships TS source whose `.mjs` imports tsc can't resolve (./aliases,
// dwc-plugin-test-kit/vitest). These ambient declarations keep that build check passing; vitest uses
// the real module at runtime, and the kit's own `dwc-plugin-typecheck` (which only checks src/, not
// tests) is unaffected. Remove once the test-kit ships type declarations.
declare module "dwc-plugin-test-kit";
declare module "dwc-plugin-test-kit/vitest";

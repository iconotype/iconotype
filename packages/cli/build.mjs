import { build } from 'esbuild'

/**
 * Bundles our own sources into one CJS entrypoint and leaves third-party packages
 * external, declared as dependencies so node resolves them from node_modules.
 *
 * Bundling the dependencies fails three separate ways, all of them silent until run
 * time: paper's node shim uses dynamic `require` (impossible in an ESM bundle, and
 * paper-core carries the same shim so the web builds' alias does not help), css-tree
 * loads `../data/patch.json` relative to its own module path, and @resvg/resvg-js is a
 * native binding. Externalising is the honest shape for a node CLI.
 *
 * CJS rather than ESM so paper's guarded `require` calls behave as they do under test.
 */
await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'bin/iconotype.cjs',
  packages: 'external',
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
})

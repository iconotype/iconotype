import { build } from 'esbuild'

/**
 * Bundles the extension host code into a single CJS file with NO runtime dependencies,
 * so the .vsix is self-contained.
 *
 * Two things need help:
 *   - paper's optional node deps (jsdom, canvas) stay external: paper guards them in
 *     try/catch and we never install them.
 *   - css-tree does `createRequire(import.meta.url)` to load `../data/patch.json`,
 *     which CJS output leaves undefined. Defining import.meta.url to this file's URL
 *     makes the require resolve against the bundle, and the JSON is inlined by esbuild.
 */
const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode', 'jsdom', 'jsdom/*', 'canvas', 'source-map-support'],
  define: { 'import.meta.url': 'importMetaUrl' },
  banner: { js: 'const importMetaUrl = require("url").pathToFileURL(__filename).href;' },
  logLevel: 'info',
}

/**
 * Two bundles, not one.
 *
 * paper.js, svg2ttf and the WOFF2 encoder are most of the weight and none of the
 * startup: the entry keeps `./heavy.js` external, so requiring the extension parses
 * only what activation needs, and the rest arrives on the first import or export.
 * esbuild's own code splitting is ESM-only, hence two passes rather than a flag.
 */
await build({ ...common, entryPoints: ['src/heavy.ts'], outfile: 'dist/heavy.js' })

await build({
  ...common,
  entryPoints: ['src/extension.ts'],
  external: [...common.external, './heavy.js'],
  outfile: 'dist/extension.js',
})

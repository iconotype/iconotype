/**
 * Everything that costs real money to load, behind one module boundary.
 *
 * paper.js, svg2ttf, the WOFF2 encoder and css-tree are ~2.5 MB of the bundle and
 * ~85 ms of module initialisation, and none of it is needed to open a window: the
 * extension activates to read project files, draw a sidebar and answer completions.
 * The work that needs them — importing an SVG, fixing geometry, building a font —
 * happens on a click, where a few tens of milliseconds cost nothing.
 *
 * `build.mjs` marks this file external in the entry bundle and compiles it separately,
 * so it is a second file that node only reads when something here is first awaited.
 * Import it ONLY through `heavy()` in `lazy.ts`, never directly, or the boundary is
 * gone and the split silently stops working.
 */
export { fixSvg, fixPaths } from '@iconotype/core-svg'
export { importSvg, importIcoMoon, importIcoMoonZip, importSvgZip } from '@iconotype/core-io'
export { resolveOutputs } from '@iconotype/core-export'
export type { OutputFile } from '@iconotype/core-export'

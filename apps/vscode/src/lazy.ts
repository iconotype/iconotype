/**
 * The one place that reaches across the lazy boundary.
 *
 * `import('./heavy.js')` is left alone by the entry bundle (see `build.mjs`), so this
 * is a real, deferred `require` of a second file — the font and SVG toolchains are not
 * touched until something actually needs them.
 */
export type Heavy = typeof import('./heavy.js')

let loaded: Promise<Heavy> | undefined

export function heavy(): Promise<Heavy> {
  // cached: the second import is free, but only after the first has resolved
  loaded ??= import('./heavy.js')
  return loaded
}

/** True once the heavy half has been loaded — asserted by the activation test. */
export const heavyLoaded = (): boolean => loaded !== undefined

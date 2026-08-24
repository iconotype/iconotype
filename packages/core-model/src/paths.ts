import type { Paths } from './types.js'

/**
 * Output destinations, always as a list.
 *
 * `Paths` is a string or an array of them, so every reader would otherwise repeat the
 * same `Array.isArray` dance and one of them would forget. Empty entries are dropped
 * here rather than at each call site: a UI that takes "app/css, " from a text field
 * must not produce a write to `""`.
 */
export const asPaths = (paths: Paths | undefined): string[] =>
  (Array.isArray(paths) ? paths : paths === undefined ? [] : [paths])
    .map((p) => p.trim())
    .filter(Boolean)

/**
 * The destination anything single-valued should use — a stylesheet's relative font
 * url, a snippet, a "where does this land" label.
 */
export const firstPath = (paths: Paths | undefined, fallback = ''): string => asPaths(paths)[0] ?? fallback

/** Collapses back to the shape a project file should hold: a string unless it has to be a list. */
export const toPaths = (paths: string[]): Paths => (paths.length === 1 ? paths[0]! : paths)

/** `app/css, app/styles` from a text field → `['app/css', 'app/styles']`. */
export const parsePathList = (text: string): string[] =>
  text.split(',').map((p) => p.trim()).filter(Boolean)

/** The inverse, for putting a `Paths` back into a text field. */
export const formatPathList = (paths: Paths | undefined): string => asPaths(paths).join(', ')

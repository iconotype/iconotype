import type { Glyph, IconSet } from '@iconotype/core-model'
import { importSvg, type SvgImportResult } from './svg-import.js'

/**
 * The icon library browser.
 *
 * Iconify's API is the only practical answer to "search every open icon set at once":
 * it indexes 230+ collections — Lucide, Material Symbols, Pictogrammers' MDI, Tabler,
 * Phosphor, Font Awesome — as one search space, serves CORS-open JSON, and carries the
 * licence and author of every collection alongside the artwork, which is what makes
 * attribution automatic rather than a thing you have to remember.
 *
 * Nothing here touches the DOM and nothing sends the project anywhere: the only bytes
 * that leave are the search query and the icon names asked for. `host` is honoured
 * end to end, so a workspace that cannot call out can point at a self-hosted
 * `iconify/api` (or a mirror) instead.
 *
 * Stroke sets like Lucide and Tabler are drawn with `stroke="currentColor"` and no
 * fill, which a font glyph cannot hold at all. They arrive here as strokes and leave
 * as outlined fills, because `importSvg` runs the same 13-stage pipeline every other
 * import does — see docs/04.
 */
export const ICONIFY_API = 'https://api.iconify.design'

export interface IconifyOptions {
  /** API root; point it at a self-hosted `iconify/api` to keep queries in-house */
  host?: string
  /** injectable for tests and for hosts that proxy their own requests */
  fetch?: typeof globalThis.fetch
  signal?: AbortSignal
}

export interface CollectionInfo {
  prefix: string
  name: string
  total: number
  version?: string
  author?: { name?: string; url?: string }
  license?: { title?: string; spdx?: string; url?: string }
  category?: string
  tags?: string[]
  /** true for multicolour sets (flags, logos) — they import as colour layers */
  palette?: boolean
  height?: number
  samples?: string[]
}

/** A `prefix:name` pair, the identity Iconify uses everywhere. */
export interface IconRef {
  prefix: string
  name: string
}

export interface SearchResult {
  icons: IconRef[]
  /** matches available, which can exceed `icons.length` */
  total: number
  /** the collections those matches came from, licence included */
  collections: Record<string, CollectionInfo>
}

export const iconRefId = (ref: IconRef): string => `${ref.prefix}:${ref.name}`

export function parseIconRef(id: string): IconRef | null {
  const at = id.indexOf(':')
  if (at <= 0 || at === id.length - 1) return null
  return { prefix: id.slice(0, at), name: id.slice(at + 1) }
}

const trimHost = (host: string) => host.replace(/\/+$/, '')

async function get<T>(path: string, opts: IconifyOptions): Promise<T> {
  const f = opts.fetch ?? globalThis.fetch
  if (!f) throw new Error('no fetch available in this environment')
  const url = `${trimHost(opts.host ?? ICONIFY_API)}${path}`
  const response = await f(url, { signal: opts.signal })
  if (!response.ok) throw new Error(`icon library: ${response.status} ${response.statusText}`)
  return (await response.json()) as T
}

/** Normalizes the API's `{prefix: {...}}` map into a list carrying its own prefix. */
function toCollections(raw: Record<string, Omit<CollectionInfo, 'prefix'>>): Record<string, CollectionInfo> {
  const out: Record<string, CollectionInfo> = {}
  for (const [prefix, info] of Object.entries(raw ?? {})) out[prefix] = { prefix, ...info }
  return out
}

/** Every collection the API serves, keyed by prefix. Cheap enough to cache for a session. */
export async function listCollections(opts: IconifyOptions = {}): Promise<Record<string, CollectionInfo>> {
  return toCollections(await get('/collections', opts))
}

export interface SearchOptions extends IconifyOptions {
  /** 32–999; the API's own default is 64 */
  limit?: number
  /** paging offset */
  start?: number
  /** restrict to these collection prefixes */
  prefixes?: string[]
  category?: string
}

/**
 * Full-text search across every indexed collection.
 *
 * An empty query returns nothing rather than throwing, so a picker can call this on
 * every keystroke without guarding.
 */
export async function searchIcons(query: string, opts: SearchOptions = {}): Promise<SearchResult> {
  const q = query.trim()
  if (!q) return { icons: [], total: 0, collections: {} }
  const params = new URLSearchParams({ query: q })
  if (opts.limit) params.set('limit', String(Math.min(999, Math.max(32, opts.limit))))
  if (opts.start) params.set('start', String(opts.start))
  if (opts.prefixes?.length) params.set('prefixes', opts.prefixes.join(','))
  if (opts.category) params.set('category', opts.category)

  const raw = await get<{ icons?: string[]; total?: number; collections?: Record<string, never> }>(
    `/search?${params}`,
    opts,
  )
  const icons = (raw.icons ?? []).map(parseIconRef).filter((r): r is IconRef => r !== null)
  return { icons, total: raw.total ?? icons.length, collections: toCollections(raw.collections ?? {}) }
}

export interface CollectionListing {
  prefix: string
  title: string
  total: number
  /** every icon name in the set, categories flattened, hidden ones dropped */
  icons: string[]
  categories: Record<string, string[]>
}

/** Browsing one set rather than searching all of them. */
export async function listCollection(prefix: string, opts: IconifyOptions = {}): Promise<CollectionListing> {
  const raw = await get<{
    prefix?: string
    title?: string
    total?: number
    uncategorized?: string[]
    categories?: Record<string, string[]>
    hidden?: string[]
  }>(`/collection?prefix=${encodeURIComponent(prefix)}`, opts)

  const categories = raw.categories ?? {}
  const hidden = new Set(raw.hidden ?? [])
  const icons = [...(raw.uncategorized ?? []), ...Object.values(categories).flat()].filter((n) => !hidden.has(n))
  return {
    prefix: raw.prefix ?? prefix,
    title: raw.title ?? prefix,
    total: raw.total ?? icons.length,
    icons,
    categories,
  }
}

interface IconifyIconData {
  body: string
  width?: number
  height?: number
  left?: number
  top?: number
  rotate?: number
  hFlip?: boolean
  vFlip?: boolean
}

interface IconifyBundle {
  prefix: string
  icons?: Record<string, IconifyIconData>
  aliases?: Record<string, IconifyIconData & { parent: string }>
  width?: number
  height?: number
  left?: number
  top?: number
  not_found?: string[]
}

/**
 * Iconify's default box is 16×16 when a set does not say otherwise; getting this wrong
 * scales every glyph in the set by the ratio, which looks like the fixer misbehaving.
 */
const DEFAULT_SIZE = 16

/**
 * Icon data to a standalone SVG document.
 *
 * The `.svg` endpoint exists but emits `width="1em" height="1em"`, which carries no
 * absolute scale — so the bundle endpoint is used instead and the box reconstructed
 * here. Alias transforms become a `<g transform>` rather than being dropped: the
 * pipeline bakes transforms anyway, so this costs nothing and keeps rotated aliases
 * (`arrow-up` as a rotation of `arrow-right`) pointing the right way.
 */
function toSvgDocument(icon: IconifyIconData, bundle: IconifyBundle): string {
  const width = icon.width ?? bundle.width ?? DEFAULT_SIZE
  const height = icon.height ?? bundle.height ?? DEFAULT_SIZE
  const left = icon.left ?? bundle.left ?? 0
  const top = icon.top ?? bundle.top ?? 0

  const parts: string[] = []
  // applied outermost-first, mirroring Iconify's own order: flips, then rotation
  if (icon.hFlip) parts.push(`translate(${left * 2 + width} 0) scale(-1 1)`)
  if (icon.vFlip) parts.push(`translate(0 ${top * 2 + height}) scale(1 -1)`)
  const quarter = ((icon.rotate ?? 0) % 4 + 4) % 4
  if (quarter) {
    const cx = left + width / 2
    const cy = top + height / 2
    parts.push(`rotate(${quarter * 90} ${cx} ${cy})`)
  }

  const body = parts.length ? `<g transform="${parts.join(' ')}">${icon.body}</g>` : icon.body
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="${left} ${top} ${width} ${height}">${body}</svg>`
  )
}

export interface FetchedIcon extends IconRef {
  svg: string
  /** the box the artwork was drawn in, for the grid hint on the glyph */
  size: number
}

/**
 * The API takes icon names in the query string, so a 500-icon request would build a
 * URL no proxy will forward. Chunked at a size that keeps every URL well under 2 kB.
 */
const NAMES_PER_REQUEST = 64

/** Fetches artwork for icons in one collection. Names the API does not know are skipped. */
export async function fetchIcons(prefix: string, names: string[], opts: IconifyOptions = {}): Promise<FetchedIcon[]> {
  const out: FetchedIcon[] = []
  for (let i = 0; i < names.length; i += NAMES_PER_REQUEST) {
    const chunk = names.slice(i, i + NAMES_PER_REQUEST)
    const bundle = await get<IconifyBundle>(
      `/${encodeURIComponent(prefix)}.json?icons=${chunk.map(encodeURIComponent).join(',')}`,
      opts,
    )
    for (const name of chunk) {
      const alias = bundle.aliases?.[name]
      const direct = bundle.icons?.[name]
      // an alias carries its own transform and inherits its parent's geometry
      const icon = direct ?? (alias ? { ...bundle.icons?.[alias.parent], ...alias } : undefined)
      if (!icon?.body) continue
      out.push({
        prefix,
        name,
        svg: toSvgDocument(icon as IconifyIconData, bundle),
        size: (icon as IconifyIconData).height ?? bundle.height ?? DEFAULT_SIZE,
      })
    }
  }
  return out
}

/** Groups mixed refs by prefix and fetches each collection in one pass. */
export async function fetchIconRefs(refs: IconRef[], opts: IconifyOptions = {}): Promise<FetchedIcon[]> {
  const byPrefix = new Map<string, string[]>()
  for (const ref of refs) {
    const names = byPrefix.get(ref.prefix)
    if (names) names.push(ref.name)
    else byPrefix.set(ref.prefix, [ref.name])
  }
  const results = await Promise.all([...byPrefix].map(([prefix, names]) => fetchIcons(prefix, names, opts)))
  // back into the caller's order, so a picker's grid matches what it asked for
  const found = new Map(results.flat().map((icon) => [iconRefId(icon), icon]))
  return refs.map((ref) => found.get(iconRefId(ref))).filter((icon): icon is FetchedIcon => icon !== undefined)
}

export interface LibraryGlyphOptions {
  /** coordinate height of the destination set */
  targetHeight?: number
  /**
   * Names already spoken for, so two `home` icons from two sets do not collide.
   *
   * Pass a `Set` and it is used in place, not copied — which is what a caller adding
   * several collections in one go needs: copying meant Tabler's `arrow-up` never saw
   * Lucide's, so both kept the name and both landed on the same codepoint.
   */
  taken?: Set<string> | Iterable<string>
  /** prefixes the glyph name with the collection, e.g. `lucide-house` */
  qualifyNames?: boolean
}

/**
 * A CSS-safe name that no glyph in the project has yet.
 *
 * Duplicate names are not cosmetic: they collide in the generated stylesheet and in
 * the ligature table, so the second `home` silently wins over the first.
 */
export function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

export interface LibraryImportResult extends SvgImportResult {
  ref: IconRef
}

/**
 * Fetched artwork to glyphs, attribution attached.
 *
 * `source` gets the collection's licence and author and a link back to the icon on
 * iconify.design, so a project assembled from four libraries can still answer "where
 * did this come from, and what does it require of me" — which is the whole reason the
 * collection metadata is threaded through instead of just the paths.
 */
export function toGlyphs(
  icons: FetchedIcon[],
  collections: Record<string, CollectionInfo>,
  opts: LibraryGlyphOptions = {},
): LibraryImportResult[] {
  const taken = opts.taken instanceof Set ? opts.taken : new Set(opts.taken ?? [])
  const out: LibraryImportResult[] = []

  for (const icon of icons) {
    const collection = collections[icon.prefix]
    const base = opts.qualifyNames ? `${icon.prefix}-${icon.name}` : icon.name
    let result: SvgImportResult
    try {
      result = importSvg(icon.svg, `${base}.svg`, { targetHeight: opts.targetHeight, grid: icon.size })
    } catch (e) {
      out.push({
        ref: icon,
        glyph: null as unknown as Glyph,
        warnings: [`${iconRefId(icon)}: ${(e as Error).message}`],
        findings: [],
      })
      continue
    }

    const name = uniqueName(result.glyph.name, taken)
    taken.add(name)
    out.push({
      ...result,
      ref: { prefix: icon.prefix, name: icon.name },
      glyph: {
        ...result.glyph,
        /*
         * Keyed on the DEDUPED name, not the icon reference.
         * Adding `lucide:arrow-up` to a project that already has it produced a second
         * glyph with an identical id, and the add op treated it as the same glyph — so
         * "Add 3" quietly added one.
         */
        id: `iconify:${icon.prefix}:${name}`,
        name,
        tags: [icon.name, icon.prefix, ...(collection?.name ? [collection.name] : [])],
        source: {
          url: `https://icon-sets.iconify.design/${icon.prefix}/${icon.name}/`,
          license: collection?.license?.spdx ?? collection?.license?.title,
          author: collection?.author?.name,
          importedFrom: iconRefId(icon),
        },
      },
    })
  }
  return out.filter((r) => r.glyph)
}

/** Set metadata for a collection, so its licence travels with the icons into the font. */
export function setMetadataFor(collection: CollectionInfo): IconSet['metadata'] {
  return {
    url: collection.author?.url,
    designer: collection.author?.name,
    designerURL: collection.author?.url,
    license: collection.license?.title ?? collection.license?.spdx,
    licenseURL: collection.license?.url,
  }
}

import type { Project } from '@glyphsmith/core-model'
import { resolveFormat, xmlEscape, type FormatOptions } from './options.js'
import { exportSvg, iconsOf, type IconEntry } from './svg.js'

/**
 * Raster outputs are produced by composing ONE SVG and rasterizing it once, rather than
 * by drawing images into a canvas and stitching. That keeps this package free of any
 * imaging dependency: the host supplies a rasterizer (resvg in node, OffscreenCanvas in
 * the browser) and everything here stays pure text.
 */
export type Rasterizer = (svg: string, width: number, height: number) => Promise<Uint8Array>

export interface SpriteOptions extends FormatOptions {
  /** rendered size of one icon, in px */
  cell?: number
  columns?: number
  margin?: number
  /** css colour for the glyphs */
  color?: string
  /** css colour behind them; omit for transparent */
  background?: string
  /** also emit a 2x sheet */
  retina?: boolean
}

export interface SpriteResult {
  svg: string
  width: number
  height: number
  /** css positioning the sheet, one rule per icon */
  css: string
  positions: Array<{ name: string; x: number; y: number }>
}

/** Lays every icon out on a grid and returns the sheet plus the CSS to address it. */
export function buildSpriteSheet(project: Project, entries: IconEntry[], options: SpriteOptions = {}): SpriteResult {
  const opts = resolveFormat(options)
  const cell = options.cell ?? 32
  const margin = options.margin ?? 16
  const columns = Math.max(1, options.columns ?? 16)
  const rows = Math.ceil(entries.length / columns)
  const step = cell + margin
  const width = columns * step - margin
  const height = rows * step - margin

  const positions: SpriteResult['positions'] = []
  const nodes = entries.map((entry, i) => {
    const x = (i % columns) * step
    const y = Math.floor(i / columns) * step
    positions.push({ name: entry.glyph.name, x, y })
    const scale = cell / entry.set.height
    const inner = entry.glyph.paths
      .map((d, j) => {
        const fill = entry.glyph.attrs[j]?.fill
        return `<path d="${d}"${fill ? ` fill="${xmlEscape(fill)}"` : ''}/>`
      })
      .join('')
    return `  <g transform="translate(${x} ${y}) scale(${scale})">${inner}</g>`
  })

  const background = options.background
    ? `  <rect width="${width}" height="${height}" fill="${xmlEscape(options.background)}"/>\n`
    : ''

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="${xmlEscape(options.color ?? '#000')}">\n` +
    background + nodes.join('\n') + '\n</svg>\n'

  const css = [
    `.${opts.prefix.replace(/-$/, '')}-sprite {`,
    `  background-image: url('sprite.png');`,
    `  background-repeat: no-repeat;`,
    `  width: ${cell}px;`,
    `  height: ${cell}px;`,
    `}`,
    ...positions.map((p) => `.${opts.prefix}${p.name}${opts.postfix}-sprite { background-position: -${p.x}px -${p.y}px; }`),
    '',
  ].join('\n')

  return { svg, width, height, css, positions }
}

export interface FaviconSize { size: number; filename: string }

export const DEFAULT_FAVICON_SIZES: FaviconSize[] = [
  { size: 16, filename: 'favicon-16.png' },
  { size: 32, filename: 'favicon-32.png' },
  { size: 180, filename: 'apple-touch-icon.png' },
  { size: 192, filename: 'icon-192.png' },
  { size: 512, filename: 'icon-512.png' },
]

/** A favicon set built from one chosen glyph, plus the web app manifest to go with it. */
export async function buildFavicons(
  entry: IconEntry, rasterize: Rasterizer,
  options: { sizes?: FaviconSize[]; color?: string; background?: string; name?: string } = {},
): Promise<Array<{ path: string; data: Uint8Array | string }>> {
  const sizes = options.sizes ?? DEFAULT_FAVICON_SIZES
  const out: Array<{ path: string; data: Uint8Array | string }> = []

  for (const { size, filename } of sizes) {
    const background = options.background
      ? `<rect width="${entry.set.height}" height="${entry.set.height}" fill="${xmlEscape(options.background)}"/>`
      : ''
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${entry.set.height} ${entry.set.height}" fill="${xmlEscape(options.color ?? '#000')}">` +
      background +
      entry.glyph.paths.map((d) => `<path d="${d}"/>`).join('') +
      `</svg>`
    out.push({ path: filename, data: await rasterize(svg, size, size) })
  }

  out.push({
    path: 'site.webmanifest',
    data: JSON.stringify({
      name: options.name ?? entry.glyph.name,
      icons: sizes
        .filter((s) => s.size >= 192)
        .map((s) => ({ src: s.filename, sizes: `${s.size}x${s.size}`, type: 'image/png' })),
    }, null, 2) + '\n',
  })
  out.push({ path: 'favicon.svg', data: exportSvg(entry, { removeNewlines: true }) })
  return out
}

/** Individual PNGs, one per icon. */
export async function buildPngs(
  entries: IconEntry[], rasterize: Rasterizer,
  options: { size?: number; color?: string; retina?: boolean } = {},
): Promise<Array<{ path: string; data: Uint8Array }>> {
  const size = options.size ?? 32
  const scales = options.retina ? [1, 2] : [1]
  const out: Array<{ path: string; data: Uint8Array }> = []
  for (const entry of entries) {
    for (const scale of scales) {
      const px = size * scale
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${entry.set.height} ${entry.set.height}" fill="${xmlEscape(options.color ?? '#000')}">` +
        entry.glyph.paths.map((d) => `<path d="${d}"/>`).join('') +
        `</svg>`
      out.push({ path: `png/${entry.glyph.name}${scale > 1 ? `@${scale}x` : ''}.png`, data: await rasterize(svg, px, px) })
    }
  }
  return out
}

export { iconsOf }

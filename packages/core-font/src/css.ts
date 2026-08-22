import type { Project } from '@iconotype/core-model'
import type { FontBuild, FontFormat } from './build.js'
import type { BuiltGlyph } from './svgfont.js'

export interface CssOptions {
  /** relative path from the stylesheet to the font files */
  fontPath?: string
  /** inline the woff2 (or woff/ttf) as a data URI instead of linking */
  embed?: boolean
  formats?: FontFormat[]
  /** cache-busting query appended to each src url */
  version?: string
}

const MIME: Record<string, string> = {
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', svg: 'image/svg+xml',
}
const FORMAT_HINT: Record<string, string> = {
  woff2: 'woff2', woff: 'woff', ttf: 'truetype', svg: 'svg',
}
/** browsers pick the first format they understand, so order matters */
const ORDER: FontFormat[] = ['woff2', 'woff', 'ttf', 'svg']

const base64 = (data: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(data).toString('base64')
}

const hex = (code: number) => code.toString(16)

/**
 * Applies IcoMoon's `${i}` / `${u}` interpolation to a class prefix or suffix:
 * `${i}` is the glyph's index in the font, `${u}` its codepoint in hex.
 * A suffix of `-${u}` turns `.icon-home` into `.icon-home-e900`.
 */
export const interpolate = (template: string, index: number, code: number): string =>
  template.replace(/\$\{i\}/g, String(index)).replace(/\$\{u\}/g, hex(code))

/** The full class name for an icon, prefix and suffix interpolated. */
export const classNameOf = (
  prefs: { prefix: string; postfix: string }, name: string, index: number, code: number,
): string => `${interpolate(prefs.prefix, index, code)}${name}${interpolate(prefs.postfix, index, code)}`

/** Glyphs grouped back into their logical icon (multicolor icons span several codepoints). */
export function groupIcons(glyphs: BuiltGlyph[]): Array<{ name: string; layers: BuiltGlyph[] }> {
  const byIcon = new Map<string, BuiltGlyph[]>()
  for (const g of glyphs) {
    const key = g.name.replace(/-path\d+$/, '')
    const bucket = byIcon.get(key)
    if (bucket) bucket.push(g)
    else byIcon.set(key, [g])
  }
  return [...byIcon.entries()].map(([name, layers]) => ({ name, layers }))
}

/**
 * One rule set per colour palette: `.palette1 .path2:before { color: … }`.
 *
 * A multicolor icon's layers each take their colour from CSS, so a project can ship
 * several palettes of the same artwork and switch between them with one class.
 */
export function buildPaletteRules(project: Project): string[] {
  const prefs = project.preferences.font
  const palettes = project.sets.flatMap((set) => set.colorThemes)
  if (!palettes.length) return []

  const out: string[] = ['/* colour palettes */']
  palettes.forEach((palette, index) => {
    const selector = `.${prefs.palettePrefix}${index + 1}`
    palette.forEach((rgba, layer) => {
      const [r, g, b, a = 1] = rgba
      const color = a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`
      out.push(`${selector} .path${layer + 1}:before { color: ${color}; }`)
    })
  })
  out.push('')
  return out
}

/**
 * The attribution block.
 *
 * Once a font can be assembled from open libraries in three keystrokes, some of the
 * artwork in it is CC BY 4.0 — which requires the credit to travel with the work, and
 * the stylesheet is the one file that always ships alongside the font. So the licences
 * the sets carry are written where they cannot be lost, rather than living only in the
 * project file a designer never opens.
 */
export function creditLines(project: Project): string[] {
  // the project roll-up survives the flat file; set metadata is the live app's copy
  const entries = project.credits?.length
    ? project.credits
    : project.sets
        .filter((s) => s.metadata.license || s.metadata.designer)
        .map((s) => ({ name: s.name, ...s.metadata }))

  const seen = new Set<string>()
  const lines: string[] = []
  for (const { name, license, designer, licenseURL, url } of entries) {
    if (!license && !designer) continue
    const credit = [name, designer && `by ${designer}`, license && `— ${license}`, licenseURL ?? url]
      .filter(Boolean)
      .join(' ')
    if (seen.has(credit)) continue
    seen.add(credit)
    lines.push(` * ${credit}`)
  }
  return lines.length ? ['/*', ' * Artwork credits:', ...lines, ' */'] : []
}

export function buildCss(project: Project, build: FontBuild, opts: CssOptions = {}): string {
  const prefs = project.preferences.font
  const family = prefs.family
  const dir = opts.fontPath ?? 'fonts/'
  const query = opts.version ? `?${opts.version}` : ''
  const available = ORDER.filter((f) => (f === 'svg' ? true : build[f] !== undefined))
    .filter((f) => !opts.formats || opts.formats.includes(f))

  const srcs: string[] = []
  if (opts.embed) {
    const first = available.find((f) => f !== 'svg' && build[f])
    if (first) {
      const data = build[first] as Uint8Array
      srcs.push(`url(data:${MIME[first]};charset=utf-8;base64,${base64(data)}) format('${FORMAT_HINT[first]}')`)
    }
  } else {
    for (const f of available) {
      const url = f === 'svg' ? `${dir}${family}.svg${query}#${family}` : `${dir}${family}.${f}${query}`
      srcs.push(`url('${url}') format('${FORMAT_HINT[f]}')`)
    }
  }

  const out: string[] = []
  if (prefs.showMetadata) {
    out.push(`/* ${family} v${prefs.majorVersion}.${prefs.minorVersion} — generated by Iconotype. Do not edit by hand. */`)
    out.push(...creditLines(project))
  }
  out.push(
    `@font-face {`,
    `  font-family: '${family}';`,
    `  src: ${srcs.join(',\n       ')};`,
    `  font-weight: normal;`,
    `  font-style: normal;`,
    `  font-display: block;`,
    `}`,
    ``,
  )

  const selector = prefs.selector === 'attribute'
    ? `[class^="${prefs.prefix}"], [class*=" ${prefs.prefix}"]`
    : prefs.classSelector
  out.push(
    `${selector} {`,
    `  font-family: '${family}' !important;`,
    `  speak: never;`,
    `  font-style: normal;`,
    `  font-weight: normal;`,
    `  font-variant: normal;`,
    `  text-transform: none;`,
    `  line-height: 1;`,
    `  -webkit-font-smoothing: antialiased;`,
    `  -moz-osx-font-smoothing: grayscale;`,
    `}`,
    ``,
  )

  const icons = groupIcons(build.glyphs)

  // a custom property per glyph, for referencing a codepoint from your own rules
  if (prefs.propertyPerGlyph || (prefs.cssVars && prefs.cssVarsFormat === 'css')) {
    out.push(`:root {`)
    icons.forEach(({ name, layers }, i) =>
      out.push(`  --${interpolate(prefs.prefix, i, layers[0]!.code)}${name}: "\\${hex(layers[0]!.code)}";`))
    out.push(`}`, ``)
  }

  if (prefs.classPerGlyph) {
    icons.forEach(({ name, layers }, i) => {
      const className = classNameOf(prefs, name, i, layers[0]!.code)
      if (layers.length === 1) {
        out.push(`.${className}:before { content: "\\${hex(layers[0]!.code)}"; }`)
        return
      }
      // IcoMoon's multicolor model: one stacked pseudo-element per colour layer
      for (const layer of layers) {
        const color = layer.color ? `\n  color: ${layer.color};` : ''
        out.push(
          `.${className} .path${layer.layer}:before {`,
          `  content: "\\${hex(layer.code)}";${color}`,
          layer.layer > 1 ? `  margin-left: -1em;` : '',
          `}`,
        )
      }
    })
  }

  if (prefs.allColorPalettes) out.push('', ...buildPaletteRules(project))

  out.push('')
  return out.filter((l) => l !== undefined).join('\n')
}

/**
 * SCSS/LESS variables, in the shape IcoMoon emits so an existing stylesheet keeps
 * working: the family and font path first, then one variable per icon.
 *
 * One deliberate difference. IcoMoon hardcodes `$icomoon-font-family` regardless of the
 * font's actual name, so two of its exports in one project collide on that variable.
 * Ours is namespaced by the family — `$app-font-family` — which cannot collide.
 */
export function buildVariables(
  project: Project, build: FontBuild, format: 'scss' | 'less',
  opts: { fontPath?: string } = {},
): string {
  const sigil = format === 'scss' ? '$' : '@'
  const suffix = format === 'scss' ? ' !default' : ''
  const prefix = project.preferences.font.prefix
  const family = project.preferences.font.family
  const fontPath = (opts.fontPath ?? 'fonts/').replace(/\/+$/, '')

  return [
    `// ${family} v${project.preferences.font.majorVersion}.${project.preferences.font.minorVersion} — generated by Iconotype. Do not edit by hand.`,
    `${sigil}${family}-font-family: "${family}"${suffix};`,
    `${sigil}${family}-font-path: "${fontPath}"${suffix};`,
    '',
    ...groupIcons(build.glyphs).map(({ name, layers }, i) =>
      `${sigil}${interpolate(prefix, i, layers[0]!.code)}${name}: "\\${hex(layers[0]!.code)}";`),
    '',
  ].join('\n')
}

export function buildDemoHtml(project: Project, build: FontBuild): string {
  const prefs = project.preferences.font
  const icons = groupIcons(build.glyphs)
  const cells = icons
    .map(({ name, layers }) => {
      const className = classNameOf(prefs, name, icons.findIndex((entry) => entry.name === name), layers[0]!.code)
      const markup = layers.length === 1
        ? `<span class="${className}"></span>`
        : `<span class="${className}">${layers.map((l) => `<span class="path${l.layer}"></span>`).join('')}</span>`
      return `      <li>
        <div class="glyph">${markup}</div>
        <div class="name">${name}</div>
        <div class="code">${layers.map((l) => 'U+' + hex(l.code)).join(' ')}</div>
      </li>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${prefs.family} — ${icons.length} icons</title>
<link rel="stylesheet" href="style.css">
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.meta { color: #888; margin: 0 0 24px; }
  ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px;
       grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
  li { border: 1px solid #8884; border-radius: 6px; padding: 14px 8px; text-align: center; }
  .glyph { font-size: 32px; line-height: 1; margin-bottom: 10px; }
  .name { font-size: 11px; word-break: break-all; }
  .code { font-size: 10px; color: #888; font-family: ui-monospace, monospace; }
  input { font: inherit; padding: 5px 9px; margin-bottom: 18px; width: 240px; }
</style>
</head>
<body>
<h1>${prefs.family}</h1>
<p class="meta">${icons.length} icons · ${build.glyphs.length} glyphs · em ${build.metrics.unitsPerEm} · generated by Iconotype</p>
<input id="q" type="search" placeholder="Filter…" oninput="for (const li of document.querySelectorAll('li')) li.hidden = !li.querySelector('.name').textContent.includes(this.value)">
<ul>
${cells}
    </ul>
</body>
</html>
`
}

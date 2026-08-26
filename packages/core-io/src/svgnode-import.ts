/**
 * Older icon-font projects — the ones people still have lying next to a NativeScript
 * or Cordova app — do not store markup. They store `glyphs`, each holding the SVG
 * already parsed into a typed tree, plus the name and codepoint the glyph shipped
 * with, and a `formats` block describing what the project exported.
 *
 * There is no `IcoMoonType` marker and no `iconSets`, so `isIcoMoonFile` rejects them
 * and the file reads as "not a project" even though it plainly is one. This turns it
 * into ours: render each tree back to SVG (svgnode.ts), then run the normal SVG import
 * so strokes, shapes and colours go through the same pipeline as any other artwork.
 */
import { defaultPreferences, emptySet, type Preferences, type Project } from '@iconotype/core-model'
import type { ImportResult } from './icomoon-import.js'
import { glyphNameFrom, importSvg } from './svg-import.js'
import { isSvgNodeProject, type SvgNodeProjectFile } from './svgnode-detect.js'
import { renderTaggedSvg } from './svgnode.js'


/** The font family the project exported under, if it said. */
function fontFamilyOf(file: SvgNodeProjectFile): string | undefined {
  for (const format of file.formats ?? []) {
    const item = (format as { item?: { tag?: string; args?: unknown[] } })?.item
    if (item?.tag !== 'ItemFont') continue
    const family = (item.args?.[0] as { fontFamily?: { value?: unknown } })?.fontFamily?.value
    if (typeof family === 'string' && family) return family
  }
  return undefined
}

export interface SvgNodeImportOptions {
  projectId?: string
  name?: string
  /** the em box glyphs are scaled into; matches the set height */
  targetHeight?: number
}

export function importSvgNodeProject(data: unknown, opts: SvgNodeImportOptions = {}): ImportResult {
  if (!isSvgNodeProject(data)) {
    throw new Error('not an icon project: expected `glyphs` with a parsed `node` tree on each')
  }
  const file = data as SvgNodeProjectFile
  const projectId = opts.projectId ?? 'p0'
  const height = opts.targetHeight ?? 1024
  const warnings: string[] = []
  const codepoints: Project['codepoints'] = {}
  const setKey = `${projectId}-set-0`

  const glyphs = file.glyphs.flatMap((g, index) => {
    const raw = g.extras?.name ?? `icon-${index}`
    const name = glyphNameFrom(raw)
    if (name !== raw) warnings.push(`glyph "${raw}": renamed to "${name}" so it is safe in CSS and ligatures`)

    const { svg, warnings: rendered } = renderTaggedSvg(g.node)
    warnings.push(...rendered.map((w) => `glyph "${name}": ${w}`))
    if (!svg) {
      warnings.push(`glyph "${name}": empty artwork; skipped`)
      return []
    }

    let result
    try {
      result = importSvg(svg, `${name}.svg`, { targetHeight: height })
    } catch (e) {
      warnings.push(`glyph "${name}": ${(e as Error).message}`)
      return []
    }
    warnings.push(...result.warnings.map((w) => `glyph "${name}": ${w}`))

    const code = g.extras?.codePoint
    if (typeof code === 'number') {
      if (codepoints[name] !== undefined) {
        warnings.push(`duplicate glyph name "${name}" — codepoints are keyed by name, first wins`)
      } else {
        codepoints[name] = code
      }
    }

    return [{
      ...result.glyph,
      id: `${setKey}:${index}`,
      name,
      tags: [raw],
      source: {},
      foreign: {
        index,
        extras: structuredClone(g.extras ?? {}),
        ...(g.palettes !== undefined ? { palettes: structuredClone(g.palettes) } : {}),
      },
    }]
  })

  const d = defaultPreferences()
  const family = fontFamilyOf(file)
  const preferences: Preferences = {
    ...d,
    font: { ...d.font, ...(family ? { family } : {}) },
  }

  return {
    warnings,
    project: {
      schemaVersion: 1,
      id: projectId,
      name: opts.name ?? family ?? 'Imported project',
      createdAt: 0,
      sets: [{ ...emptySet(setKey, family ?? 'Icons'), height, glyphs }],
      preferences,
      codepoints,
      foreign: {
        kind: 'svgnode',
        formats: structuredClone(file.formats ?? []),
        ...(file.palettes !== undefined ? { palettes: structuredClone(file.palettes) } : {}),
      },
    },
  }
}

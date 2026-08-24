import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { importIcoMoon } from '@iconotype/core-io'
import type { Project } from '@iconotype/core-model'
import { SNIPPET_TARGETS, buildAllSnippets, buildSnippets, sampleIcons, snippetsMarkdown } from '../src/index.js'

const base = importIcoMoon(JSON.parse(readFileSync(
  fileURLToPath(new URL('../../../fixtures/icomoon/alpimaps.json', import.meta.url)), 'utf8'))).project

const codeOf = (project: Project, name: string) => {
  const v = project.codepoints[name]
  return Array.isArray(v) ? v[0]! : v!
}

describe('sample icons', () => {
  it('uses the project’s real icons and their allocated codepoints', () => {
    const [first] = sampleIcons(base)
    expect(first!.name).toBe(base.sets[0]!.glyphs[0]!.name)
    expect(first!.name).toMatch(/^[a-zA-Z0-9_-]+$/)
    expect(first!.code).toBe(codeOf(base, first!.name))
    expect(first!.className).toBe(`${base.preferences.font.prefix}${first!.name}`)
  })

  it('skips a name that would make a broken class', () => {
    // the fixture has "paper-plane-o, send-o" — a glyph and its alias in one name
    expect(sampleIcons(base, 3).map((i) => i.name)).not.toContain('paper-plane-o, send-o')
  })

  it('falls back to plausible names when nothing is selected yet', () => {
    const empty: Project = { ...base, sets: [] }
    expect(sampleIcons(empty).map((i) => i.name)).toEqual(['home', 'search', 'settings'])
  })
})

describe('snippets', () => {
  it('covers every advertised target', () => {
    for (const { id } of SNIPPET_TARGETS) {
      const group = buildSnippets(base, id)
      expect(group.snippets.length, id).toBeGreaterThan(0)
      for (const s of group.snippets) expect(s.code.trim(), `${id}/${s.id}`).not.toBe('')
    }
  })

  it('writes the project’s own family and class names, never a placeholder', () => {
    const family = base.preferences.font.family
    const icon = sampleIcons(base)[0]!
    const html = buildSnippets(base, 'html').snippets
    expect(html[0]!.code).toContain(`${family}.woff2`)
    expect(html[0]!.code).toContain(`class="${icon.className}"`)
    expect(JSON.stringify(buildAllSnippets(base))).not.toContain('your-font')
  })

  it('follows the project’s output paths when it has them', () => {
    const project: Project = {
      ...base,
      output: {
        fonts: { dir: 'app/assets/fonts', formats: ['woff2', 'ttf'] },
        styles: [{ kind: 'scss', path: 'app/styles/icons.scss' }, { kind: 'json', path: 'app/icons.json' }],
      },
    }
    const vite = buildSnippets(project, 'vite').snippets
    expect(vite.find((s) => s.id === 'vite-import')!.code).toContain('app/styles/icons.scss')
    expect(vite.find((s) => s.id === 'vite-codepoints')!.code).toContain("import icons from './app/icons.json'")
    expect(buildSnippets(project, 'html').snippets[0]!.code).toContain('app/assets/fonts/')
  })

  it('never asks a browser to link a stylesheet it cannot parse', () => {
    const project: Project = { ...base, output: { styles: [{ kind: 'scss', path: 'app/css/icons.scss' }] } }
    const link = buildSnippets(project, 'html').snippets[0]!.code
    expect(link).toContain('href="style.css"')
    expect(link).not.toContain('.scss')
  })

  it('asks for a JSON map when the project has no output configured', () => {
    const note = buildSnippets(base, 'webpack').snippets.find((s) => s.id === 'webpack-codepoints')!.note!
    expect(note).toContain('Add a `json` output')
  })

  it('rewrites the prefix the SOURCE uses, not the class prefix, when they differ', () => {
    const project: Project = {
      ...base,
      preferences: {
        ...base.preferences,
        font: { ...base.preferences.font, usagePrefixes: ['alpimaps-'] },
      },
    }
    const code = buildSnippets(project, 'webpack').snippets.find((s) => s.id === 'webpack-codepoints')!.code
    expect(code).toContain("search: 'alpimaps-([a-z0-9_-]+)'")
  })

  it('warns when a native target needs a format the project does not export', () => {
    const project: Project = { ...base, output: { fonts: { dir: 'fonts', formats: ['woff2'] } } }
    expect(buildSnippets(project, 'flutter').snippets[0]!.note).toContain('Turn TTF on')
    expect(buildSnippets(base, 'flutter').snippets[0]!.note).not.toContain('Turn TTF on')
  })

  it('renders every group into one Markdown document', () => {
    const md = snippetsMarkdown(base)
    for (const { label } of SNIPPET_TARGETS) expect(md).toContain(`## ${label}`)
    expect(md.match(/```/g)!.length % 2).toBe(0)
  })
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { importIcoMoon } from '@iconotype/core-io'
import {
  buildStamp, defaultOutputConfig, outputConfigFor, outputPaths, relativeFontPath, resolveOutputs, styleFileName,
} from '../src/index.js'

const base = () => importIcoMoon(JSON.parse(readFileSync(
  fileURLToPath(new URL('../../../fixtures/icomoon/alpimaps.json', import.meta.url)), 'utf8'))).project

describe('font url resolution', () => {
  it('walks from the stylesheet to the fonts directory', () => {
    // the layout this was written for: fonts in app/fonts, styles in app/css
    expect(relativeFontPath('app/css/_icons.scss', 'app/fonts')).toBe('../fonts/')
    expect(relativeFontPath('app/css/deep/x.scss', 'app/fonts')).toBe('../../fonts/')
    expect(relativeFontPath('css/icons.css', 'fonts')).toBe('../fonts/')
    expect(relativeFontPath('app/icons.css', 'app/fonts')).toBe('fonts/')
    expect(relativeFontPath('icons.css', 'fonts')).toBe('fonts/')
  })
})

describe('several destinations for one output', () => {
  const project = () => {
    const p = base()
    p.output = {
      fonts: { dir: ['app/fonts', 'public/fonts'], formats: ['woff2'] },
      styles: [{ kind: 'css', path: ['app/css/icons.css', 'packages/ui/icons.css'] }],
      types: { path: ['app/icons.d.ts'] },
    }
    return p
  }

  it('writes the same bytes to every path the config names', async () => {
    const { files } = await resolveOutputs(project())
    const fonts = files.filter((f) => f.kind === 'font').map((f) => f.path)
    const styles = files.filter((f) => f.kind === 'style')
    expect(fonts).toEqual(['app/fonts/alpimaps.woff2', 'public/fonts/alpimaps.woff2'])
    expect(styles.map((f) => f.path)).toEqual(['app/css/icons.css', 'packages/ui/icons.css'])
    expect(styles[0]!.data).toBe(styles[1]!.data)
  })

  it('points both copies of a stylesheet at the first fonts directory', async () => {
    const { files } = await resolveOutputs(project())
    // one file, one url: two copies at different depths cannot each have their own
    for (const style of files.filter((f) => f.kind === 'style')) {
      expect(style.data as string).toContain("url('../fonts/alpimaps.woff2')")
    }
  })

  it('reports every copy as generated, so nothing is mistaken for hand-written', () => {
    expect(outputPaths(project())).toEqual([
      'app/fonts/alpimaps.woff2', 'public/fonts/alpimaps.woff2',
      'app/css/icons.css', 'packages/ui/icons.css',
      'app/icons.d.ts',
    ])
  })

  it('still accepts a plain string, which is what every project file holds today', async () => {
    const p = base()
    p.output = { fonts: { dir: 'fonts', formats: ['woff2'] }, styles: [{ kind: 'css', path: 'style.css' }] }
    const { files } = await resolveOutputs(p)
    expect(files.map((f) => f.path)).toEqual(['fonts/alpimaps.woff2', 'style.css'])
  })
})

describe('direct output resolution', () => {
  const configured = () => {
    const project = base()
    project.output = {
      fonts: { dir: 'app/fonts', formats: ['woff2', 'woff'] },
      styles: [
        { kind: 'scss-variables', path: 'app/css/_icons.scss' },
        { kind: 'css', path: 'app/css/icons.css' },
      ],
      types: { path: 'app/types/icons.d.ts' },
    }
    return project
  }

  it('writes fonts, styles and types to their configured paths', async () => {
    const { files } = await resolveOutputs(configured())
    expect(files.map((f) => f.path)).toEqual([
      'app/fonts/alpimaps.woff2',
      'app/fonts/alpimaps.woff',
      'app/css/_icons.scss',
      'app/css/icons.css',
      'app/types/icons.d.ts',
    ])
    expect(files.filter((f) => f.kind === 'font')).toHaveLength(2)
  })

  it('points the stylesheet at the fonts folder, not at the project root', async () => {
    const { files } = await resolveOutputs(configured())
    const css = String(files.find((f) => f.path === 'app/css/icons.css')!.data)
    expect(css).toContain(`url('../fonts/alpimaps.woff2')`)
    expect(css).not.toContain('app/fonts')
  })

  it('honours an explicit publicPath, for asset pipelines that rewrite urls', async () => {
    const project = configured()
    project.output!.fonts!.publicPath = '~assets/fonts/'
    const { files } = await resolveOutputs(project)
    expect(String(files.find((f) => f.path === 'app/css/icons.css')!.data)).toContain(`url('~assets/fonts/alpimaps.woff2')`)
  })

  it('emits variables in each supported syntax', async () => {
    const project = base()
    project.output = {
      fonts: { dir: 'f', formats: ['woff2'] },
      styles: [
        { kind: 'scss-variables', path: 'a.scss' },
        { kind: 'less-variables', path: 'a.less' },
        { kind: 'css-variables', path: 'a.css' },
        { kind: 'json', path: 'a.json' },
      ],
    }
    const { files } = await resolveOutputs(project)
    const at = (p: string) => String(files.find((f) => f.path === p)!.data)
    expect(at('a.scss')).toContain('$icon-hiking: "\\e914";')
    // the font path in the variables must be relative to the stylesheet, like the CSS
    expect(at('a.scss')).toContain('$alpimaps-font-path: "f" !default;')
    expect(at('a.less')).toContain('@icon-hiking: "\\e914";')
    expect(at('a.css')).toContain('--icon-hiking: "\\e914";')
    expect(JSON.parse(at('a.json')).hiking).toBe('e914')
  })

  it('excludes deselected icons from the font and from the variables', async () => {
    const project = configured()
    project.sets[0]!.glyphs.find((g) => g.name === 'directions_walk')!.selected = false
    const { files, build } = await resolveOutputs(project)
    expect(build.glyphs.some((g) => g.name === 'directions_walk')).toBe(false)
    expect(String(files.find((f) => f.path === 'app/css/_icons.scss')!.data)).not.toContain('directions_walk')
  })

  it('produces the same bytes on every run', async () => {
    const a = await resolveOutputs(configured())
    await new Promise((r) => setTimeout(r, 1100))
    const b = await resolveOutputs(configured())
    expect(Buffer.from(a.files[0]!.data as Uint8Array)).toEqual(Buffer.from(b.files[0]!.data as Uint8Array))
  })

  it('offers a sensible default configuration', () => {
    expect(defaultOutputConfig('app')).toEqual({
      fonts: { dir: 'fonts', formats: ['woff2', 'woff', 'ttf'] },
      styles: [{ kind: 'css', path: 'css/app.css' }],
    })
  })
})

describe('output layout', () => {
  it('writes an scss variables file as a partial', () => {
    expect(styleFileName('app', 'scss-variables')).toBe('_app.scss')
    // a full stylesheet is not a partial: sass compiles it to app.css on its own
    expect(styleFileName('app', 'scss')).toBe('app.scss')
    expect(styleFileName('app', 'less-variables')).toBe('app.less')
    expect(styleFileName('app', 'css')).toBe('app.css')
    expect(styleFileName('app', 'dart')).toBe('app.dart')
  })

  it('builds the config the import wizard and the CLI both produce', () => {
    expect(outputConfigFor({
      name: 'app', fontsDir: 'app/fonts/', stylesDir: 'app/css/', styleKind: 'scss-variables',
    })).toEqual({
      fonts: { dir: 'app/fonts', formats: ['woff2', 'woff', 'ttf'] },
      styles: [{ kind: 'scss-variables', path: 'app/css/_app.scss' }],
    })
  })

  it('resolves a font url from the layout it just built', async () => {
    const project = { ...base(), output: outputConfigFor({
      name: 'app', fontsDir: 'app/fonts', stylesDir: 'app/css', styleKind: 'scss-variables',
    }) }
    const { files } = await resolveOutputs(project, { timestamp: 0 })
    const style = files.find((f) => f.path === 'app/css/_app.scss')!
    // the fonts dir is a sibling of the css dir, so the stylesheet must walk up
    expect(String(style.data)).toContain('-font-path: "../fonts" !default;')
  })

  it('drops the directory when the styles dir is empty', () => {
    expect(outputConfigFor({ name: 'app', stylesDir: '' }).styles![0]!.path).toBe('app.css')
  })
})

describe('build staleness', () => {
  const withOutput = () => ({
    ...base(),
    output: outputConfigFor({ name: 'app', fontsDir: 'app/fonts', stylesDir: 'app/css', styleKind: 'scss-variables' }),
  })

  it('is stable for the same project', () => {
    expect(buildStamp(withOutput())).toBe(buildStamp(withOutput()))
  })

  it('changes when the artwork, a name, a codepoint or the output config changes', () => {
    const start = buildStamp(withOutput())

    const renamed = withOutput()
    renamed.sets[0]!.glyphs[0]!.name = 'renamed'
    expect(buildStamp(renamed)).not.toBe(start)

    const redrawn = withOutput()
    redrawn.sets[0]!.glyphs[0]!.paths = ['M0 0h1v1h-1z']
    expect(buildStamp(redrawn)).not.toBe(start)

    const moved = withOutput()
    moved.codepoints[moved.sets[0]!.glyphs[0]!.name] = 0xef00
    expect(buildStamp(moved)).not.toBe(start)

    const elsewhere = withOutput()
    elsewhere.output = outputConfigFor({ name: 'app', fontsDir: 'dist/fonts', stylesDir: 'app/css' })
    expect(buildStamp(elsewhere)).not.toBe(start)

    const deselected = withOutput()
    deselected.sets[0]!.glyphs[0]!.selected = false
    expect(buildStamp(deselected)).not.toBe(start)
  })

  it('ignores what cannot reach the output', () => {
    const start = buildStamp(withOutput())

    // tags are metadata for searching, not something a build writes
    const tagged = withOutput()
    tagged.sets[0]!.glyphs[0]!.tags = ['totally', 'different']
    expect(buildStamp(tagged)).toBe(start)

    // and neither is the project's own display name
    const named = withOutput()
    named.name = 'something else'
    expect(buildStamp(named)).toBe(start)
  })

  it('lists exactly the files a build writes', () => {
    expect(outputPaths(withOutput())).toEqual([
      'app/fonts/alpimaps.woff2', 'app/fonts/alpimaps.woff', 'app/fonts/alpimaps.ttf', 'app/css/_app.scss',
    ])
    expect(outputPaths(base())).toEqual([])
  })
})

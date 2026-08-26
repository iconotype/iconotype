import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { run } from '../src/cli.js'
import { diffProjects, loadProject } from '../src/commands.js'
import { importIcoMoon } from '@iconotype/core-io'

const FIXTURE = fileURLToPath(new URL('../../../fixtures/icomoon/alpimaps.json', import.meta.url))
const SVG_FIXTURES = fileURLToPath(new URL('../../../fixtures/svg/', import.meta.url))
const SVGNODE_FIXTURE = fileURLToPath(new URL('../../../fixtures/svgnode/eosya.json', import.meta.url))

let out: string[] = []
let err: string[] = []
const io = { log: (m: string) => out.push(m), error: (m: string) => err.push(m) }
const exec = (...argv: string[]) => run(argv, io)

const tmp = () => mkdtempSync(join(tmpdir(), 'iconotype-'))

beforeEach(() => { out = []; err = [] })

describe('iconotype build', () => {
  it('builds a full package from a real IcoMoon project', async () => {
    const dir = tmp()
    expect(await exec('build', '--input', FIXTURE, '--out', dir, '--types', '--components', 'svelte,react')).toBe(0)

    const files = readdirSync(dir)
    expect(files).toContain('style.css')
    expect(files).toContain('demo.html')
    expect(files).toContain('icons.d.ts')
    expect(files).toContain('Alpimaps.svelte')
    expect(files).toContain('Alpimaps.tsx')
    // default formats are woff2,woff,ttf — the SVG font is opt-in via --formats
    expect(readdirSync(join(dir, 'fonts')).sort()).toEqual(['alpimaps.ttf', 'alpimaps.woff', 'alpimaps.woff2'])
    expect(out.join()).toMatch(/built 27 glyph\(s\) from 25 icon\(s\)/)
  })

  it('includes the SVG font when asked', async () => {
    const dir = tmp()
    await exec('build', '--input', FIXTURE, '--out', dir, '--formats', 'woff2,svg', '--quiet')
    expect(readdirSync(join(dir, 'fonts')).sort()).toEqual(['alpimaps.svg', 'alpimaps.woff2'])
  })

  it('emits a lockfile that keeps codepoints stable across rebuilds', async () => {
    const dir = tmp()
    const project = join(dir, 'project.json')
    writeFileSync(project, readFileSync(FIXTURE, 'utf8'))

    await exec('build', '--input', project, '--out', join(dir, 'a'), '--quiet')
    const lock = readFileSync(join(dir, 'codepoints.lock'), 'utf8')
    expect(lock).toContain('directions_walk\tU+e910')

    await exec('build', '--input', project, '--out', join(dir, 'b'), '--quiet')
    expect(readFileSync(join(dir, 'codepoints.lock'), 'utf8')).toBe(lock)
  })

  it('is reproducible: two builds produce identical bytes', async () => {
    const a = tmp(), b = tmp()
    await exec('build', '--input', FIXTURE, '--out', a, '--quiet')
    await new Promise((r) => setTimeout(r, 1100))
    await exec('build', '--input', FIXTURE, '--out', b, '--quiet')
    for (const name of ['fonts/alpimaps.ttf', 'fonts/alpimaps.woff2', 'style.css']) {
      expect(readFileSync(join(a, name)), name).toEqual(readFileSync(join(b, name)))
    }
  })

  /**
   * An older icon-font project, storing each glyph as a parsed SVG tree. The point of
   * the test is the codepoints: an app that already ships `\ue900` in its markup has
   * to get the same font back, not a renumbered one.
   */
  it('builds from an older icon-font project, keeping its codepoints', async () => {
    const dir = tmp()
    expect(await exec('build', '--input', SVGNODE_FIXTURE, '--out', dir)).toBe(0)

    const { project } = loadProject(SVGNODE_FIXTURE)
    expect(project.sets[0]!.glyphs).toHaveLength(55)
    expect(project.codepoints.altitude).toBe(0xf000)
    expect(project.codepoints.summit).toBe(0xe92d)
    expect(project.preferences.font.family).toBe('app')

    const css = readFileSync(join(dir, 'style.css'), 'utf8')
    expect(css).toContain('\\e92d')
    expect(readdirSync(join(dir, 'fonts'))).toContain('app.woff2')
  })

  it('builds from a folder of SVGs, assigning codepoints from 0xe900', async () => {
    const src = tmp(), dir = tmp()
    for (const name of ['stroke-lucide-style', 'shape-circle', 'winding-evenodd-donut']) {
      writeFileSync(join(src, name + '.svg'), readFileSync(join(SVG_FIXTURES, name + '.svg')))
    }
    expect(await exec('build', '--input', src, '--out', dir, '--sprite')).toBe(0)
    expect(readFileSync(join(src, 'codepoints.lock'), 'utf8')).toMatch(/shape-circle\tU\+e900/)
    expect(existsSync(join(dir, 'sprite.png'))).toBe(true)
    expect(readFileSync(join(dir, 'sprite.svg'), 'utf8')).toContain('<symbol id="icon-shape-circle"')
  })

  it('builds a favicon set from one icon', async () => {
    const dir = tmp()
    expect(await exec('build', '--input', FIXTURE, '--out', dir, '--favicon', 'hiking', '--quiet')).toBe(0)
    expect(readdirSync(dir)).toEqual(expect.arrayContaining(['favicon-16.png', 'apple-touch-icon.png', 'site.webmanifest', 'favicon.svg']))
    // a PNG, not an SVG mislabelled as one
    expect([...readFileSync(join(dir, 'favicon-32.png')).subarray(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG')
  })

  it('refuses an unknown favicon name instead of emitting nothing', async () => {
    expect(await exec('build', '--input', FIXTURE, '--out', tmp(), '--favicon', 'nope')).toBe(1)
    expect(err.join()).toMatch(/is not an icon in this project/)
  })
})

describe('iconotype init', () => {
  it('turns an IcoMoon project into a committed .iconotype.json', async () => {
    const dir = tmp()
    const out = join(dir, 'app.iconotype.json')
    expect(await exec(
      'init', '--input', FIXTURE, '--out', out, '--name', 'app', '--prefix', 'app-',
      '--fonts-dir', 'app/fonts', '--styles-dir', 'app/css', '--style-kind', 'scss-variables',
    )).toBe(0)

    const file = JSON.parse(readFileSync(out, 'utf8'))
    expect(file.schemaVersion).toBe(1)
    expect(file.name).toBe('app')
    expect(file.font.prefix).toBe('app-')
    expect(file.icons).toHaveLength(25)
    expect(file.output).toEqual({
      fonts: { dir: 'app/fonts', formats: ['woff2', 'woff', 'ttf'] },
      styles: [{ kind: 'scss-variables', path: 'app/css/_app.scss' }],
    })
    // codepoints come across untouched — they are the font's API
    expect(file.icons.find((i: { name: string }) => i.name === 'directions_walk').code).toBe('e910')
    expect(out).toContain('.iconotype.json')
  })

  /**
   * The point of putting `output` in the committed file: a build from CI writes exactly
   * where the editor extension writes. Without this, the CLI silently ignored it and
   * produced a dist/ folder nobody's bundler was looking at.
   */
  it('writes to the paths the project file names, with no --out', async () => {
    const dir = tmp()
    const project = join(dir, 'app.iconotype.json')
    await exec(
      'init', '--input', FIXTURE, '--out', project, '--name', 'app',
      '--fonts-dir', 'app/fonts', '--styles-dir', 'app/css', '--style-kind', 'scss-variables',
    )
    out = []
    expect(await exec('build', '--input', project)).toBe(0)

    expect(existsSync(join(dir, 'app/fonts/app.woff2')), 'font not written to app/fonts').toBe(true)
    expect(existsSync(join(dir, 'app/fonts/app.ttf'))).toBe(true)
    const scss = readFileSync(join(dir, 'app/css/_app.scss'), 'utf8')
    expect(scss).toContain('$app-font-family: "app" !default;')
    expect(scss).toContain('$app-font-path: "../fonts" !default;')
    // the CLASS prefix is preserved from the source project (existing markup keeps
    // working); only the family was renamed. Pass --prefix to change it.
    expect(scss).toContain('$icon-hiking:')
    expect(out.join()).toMatch(/app\/fonts\/app\.woff2/)
  })

  it('--out still produces the packaged layout', async () => {
    const dir = tmp()
    const project = join(dir, 'kit.iconotype.json')
    await exec('init', '--input', FIXTURE, '--out', project, '--name', 'kit', '--fonts-dir', 'assets/fonts')
    expect(await exec('build', '--input', project, '--out', join(dir, 'dist'), '--quiet')).toBe(0)
    expect(existsSync(join(dir, 'dist', 'fonts', 'kit.woff2'))).toBe(true)
    expect(existsSync(join(dir, 'dist', 'demo.html'))).toBe(true)
    // and it must NOT also scatter files into the project's own output paths
    expect(existsSync(join(dir, 'assets/fonts/kit.woff2'))).toBe(false)
  })

  // Regression: the CLI must read the very file format it writes. It first mistook a
  // .iconotype.json for a raw internal Project because both carry schemaVersion: 1.
  it('round-trips: init writes it, every other command reads it', async () => {
    const dir = tmp()
    const project = join(dir, 'kit.iconotype.json')
    await exec('init', '--input', FIXTURE, '--out', project, '--name', 'kit')

    out = []
    expect(await exec('info', '--input', project, '--json')).toBe(0)
    const summary = JSON.parse(out.join('\n'))
    expect(summary.family).toBe('kit')
    expect(summary.icons).toBe(25)

    out = []
    expect(await exec('lint', '--input', project)).toBe(0)
    expect(await exec('diff', project, project)).toBe(0)
  })

  it('works from a folder of SVGs too', async () => {
    const src = tmp()
    writeFileSync(join(src, 'star.svg'), readFileSync(join(SVG_FIXTURES, 'shape-polygon.svg')))
    const out = join(tmp(), 'icons.iconotype.json')
    expect(await exec('init', '--input', src, '--out', out, '--name', 'icons')).toBe(0)
    const file = JSON.parse(readFileSync(out, 'utf8'))
    expect(file.icons.map((i: { name: string }) => i.name)).toEqual(['star'])
    expect(file.icons[0].code).toBe('e900')
  })
})

describe('iconotype lint', () => {
  it('reports what the fixer would change in a folder of SVGs', async () => {
    const src = tmp()
    writeFileSync(join(src, 'masked.svg'), readFileSync(join(SVG_FIXTURES, 'mask-black-cuts.svg')))
    writeFileSync(join(src, 'clean.svg'), readFileSync(join(SVG_FIXTURES, 'shape-circle.svg')))
    expect(await exec('lint', '--input', src)).toBe(0)
    expect(out.join('\n')).toMatch(/masked\.svg: MASK_APPROXIMATED/)
    expect(out.join('\n')).toMatch(/0 error\(s\), 1 warning\(s\)/)
  })

  it('fails the build when warnings exceed --max-warnings', async () => {
    const src = tmp()
    writeFileSync(join(src, 'masked.svg'), readFileSync(join(SVG_FIXTURES, 'mask-black-cuts.svg')))
    expect(await exec('lint', '--input', src, '--max-warnings', '0')).toBe(1)
  })

  it('exits non-zero on an error-level finding', async () => {
    const src = tmp()
    writeFileSync(join(src, 'texty.svg'), readFileSync(join(SVG_FIXTURES, 'unsupported-text.svg')))
    expect(await exec('lint', '--input', src)).toBe(1)
    expect(out.join('\n')).toMatch(/TEXT_ELEMENT/)
  })

  it('emits machine-readable findings', async () => {
    const src = tmp()
    writeFileSync(join(src, 'masked.svg'), readFileSync(join(SVG_FIXTURES, 'mask-black-cuts.svg')))
    await exec('lint', '--input', src, '--json')
    const report = JSON.parse(out.join('\n'))
    expect(report.warnings).toBe(1)
    expect(report.findings[0].code).toBe('MASK_APPROXIMATED')
  })
})

describe('iconotype fix', () => {
  it('is a dry run unless --write is passed', async () => {
    const src = tmp()
    const file = join(src, 'stroke.svg')
    const original = readFileSync(join(SVG_FIXTURES, 'stroke-lucide-style.svg'), 'utf8')
    writeFileSync(file, original)

    expect(await exec('fix', '--input', src)).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe(original)
    expect(out.join('\n')).toMatch(/would change/)

    expect(await exec('fix', '--input', src, '--write')).toBe(0)
    const fixed = readFileSync(file, 'utf8')
    expect(fixed).not.toBe(original)
    expect(fixed).not.toMatch(/stroke=/)      // the stroke became an outline
    expect(fixed).toContain('viewBox="0 0 1024 1024"')
  })
})

describe('iconotype diff', () => {
  const base = () => importIcoMoon(JSON.parse(readFileSync(FIXTURE, 'utf8'))).project

  it('sees an addition as non-breaking', () => {
    const before = base()
    const after = base()
    after.codepoints.brandnew = 0xe999
    const result = diffProjects(before, after)
    expect(result.added.map((a) => a.name)).toEqual(['brandnew'])
    expect(result.breaking).toBe(false)
  })

  it('treats a REMOVED codepoint as breaking', () => {
    const before = base()
    const after = base()
    delete after.codepoints.hiking
    expect(diffProjects(before, after).breaking).toBe(true)
  })

  it('treats a MOVED codepoint as breaking — a stale stylesheet would render the wrong icon', () => {
    const before = base()
    const after = base()
    after.codepoints.hiking = 0xe950
    const result = diffProjects(before, after)
    expect(result.moved).toEqual([{ name: 'hiking', from: 0xe914, to: 0xe950 }])
    expect(result.breaking).toBe(true)
  })

  it('sees redrawn artwork at the same codepoint as non-breaking', () => {
    const before = base()
    const after = base()
    after.sets[0]!.glyphs[0]!.paths = ['M0 0H100V100H0Z']
    const result = diffProjects(before, after)
    expect(result.changed).toEqual(['directions_walk'])
    expect(result.breaking).toBe(false)
  })

  it('exits non-zero on a breaking change, and zero with --allow-breaking', async () => {
    const dir = tmp()
    const before = join(dir, 'before.json')
    const after = join(dir, 'after.json')
    writeFileSync(before, readFileSync(FIXTURE, 'utf8'))
    const mutated = JSON.parse(readFileSync(FIXTURE, 'utf8'))
    mutated.iconSets[0].selection[0].code = 60000   // move directions_walk
    writeFileSync(after, JSON.stringify(mutated))

    expect(await exec('diff', before, after)).toBe(1)
    expect(err.join()).toMatch(/BREAKING/)
    expect(await exec('diff', before, after, '--allow-breaking')).toBe(0)
  })
})

describe('iconotype scan', () => {
  it('finds which icons a codebase references', async () => {
    const source = tmp()
    mkdirSync(join(source, 'components'), { recursive: true })
    writeFileSync(join(source, 'app.html'), '<i class="icon-hiking"></i><i class="icon-running"></i>')
    writeFileSync(join(source, 'components', 'Nav.svelte'), '<Icon name="touring" />')
    writeFileSync(join(source, 'notes.txt'), 'icon-enduro mentioned in an unscanned file type')

    await exec('scan', '--input', FIXTURE, '--source', source, '--json')
    const report = JSON.parse(out.join('\n'))
    expect(report.total).toBe(25)
    expect(report.counts.hiking).toBe(1)
    expect(report.counts.touring).toBe(1)
    expect(report.unused).toContain('enduro')       // .txt is not scanned
    expect(report.unused).not.toContain('running')
  })

  /**
   * Regression from a real run: `scan` reported every icon as used because it counted
   * the stylesheet the build had just generated, which names all of them.
   */
  it('ignores the stylesheet it generated itself', async () => {
    const dir = tmp()
    const project = join(dir, 'app.iconotype.json')
    await exec('init', '--input', FIXTURE, '--out', project, '--name', 'app', '--prefix', 'app-',
      '--fonts-dir', 'app/fonts', '--styles-dir', 'app/css', '--style-kind', 'scss-variables')
    await exec('build', '--input', project)

    mkdirSync(join(dir, 'app/components'), { recursive: true })
    writeFileSync(join(dir, 'app/components/Map.vue'), '<Label class="app-hiking" /><Label class="app-touring" />')

    out = []
    await exec('scan', '--input', project, '--source', join(dir, 'app'), '--json')
    const report = JSON.parse(out.join('\n'))
    expect(report.used, 'the generated stylesheet was counted as usage').toBe(2)
    expect(report.unused).toContain('enduro')
  })

  it('can fail a build when icons are unreferenced', async () => {
    const source = tmp()
    writeFileSync(join(source, 'app.html'), '<i class="icon-hiking"></i>')
    expect(await exec('scan', '--input', FIXTURE, '--source', source, '--fail-on-unused')).toBe(1)
  })
})

describe('iconotype info and usage', () => {
  it('summarises a project', async () => {
    expect(await exec('info', '--input', FIXTURE, '--json')).toBe(0)
    const summary = JSON.parse(out.join('\n'))
    expect(summary.family).toBe('alpimaps')
    expect(summary.icons).toBe(25)
    expect(summary.glyphs).toBe(27)
    expect(summary.emSize).toBe(512)
  })

  it('prints usage and exits non-zero with no command', async () => {
    expect(await exec()).toBe(1)
    expect(out.join()).toMatch(/usage: iconotype/)
  })

  it('rejects an unknown command', async () => {
    expect(await exec('frobnicate')).toBe(2)
    expect(err.join()).toMatch(/unknown command/)
  })
})

describe('project loading', () => {
  it('applies an existing lockfile before allocating new codepoints', () => {
    const dir = tmp()
    const src = join(dir, 'icons')
    mkdirSync(src)
    writeFileSync(join(src, 'alpha.svg'), '<svg viewBox="0 0 24 24"><rect width="24" height="24"/></svg>')
    writeFileSync(join(src, 'beta.svg'), '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>')
    const lock = join(dir, 'codepoints.lock')
    writeFileSync(lock, 'beta\tU+e905\n')

    const { project } = loadProject(src, { lock })
    expect(project.codepoints.beta).toBe(0xe905)     // honoured, not reassigned
    expect(project.codepoints.alpha).toBe(0xe906)    // appended past the highest
  })
})

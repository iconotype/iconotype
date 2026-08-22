import type { Host } from '@iconotype/core-host'
import { allocate, emptySet, type Glyph, type GlyphId, type SetId } from '@iconotype/core-model'
import type { FontFormat } from '@iconotype/core-font'
import type { Finding } from '@iconotype/core-svg'
import type { FontPrefs } from '@iconotype/core-model'

/**
 * core-io and core-font are loaded ON DEMAND, never at boot.
 *
 * Between them they pull paper.js (~200 kB, stroke outlining) and the WOFF2 encoder's
 * wasm (~1 MB). Statically imported they made the initial bundle 631 kB gzip for a
 * screen that shows an empty project; dynamic imports keep first paint small and let
 * Vite emit them as separate chunks fetched on the first import/export.
 */
const io = () => import('@iconotype/core-io')
const fontkit = () => import('@iconotype/core-font')
const svgkit = () => import('@iconotype/core-svg')
const exportkit = () => import('@iconotype/core-export')
import { getContext, setContext } from 'svelte'
import { SessionStore } from './session.svelte.js'
import { debounce, saveProject } from './persistence.js'

export interface Notice { kind: 'info' | 'warn' | 'error'; text: string; at: number }

/** UI state + the actions that mutate the document. Components stay dumb. */
export class AppStore {
  session: SessionStore
  #host: Host
  #now: () => number

  search = $state('')
  cellSize = $state(32)
  // raw for the same reason as SessionStore: replaced wholesale, and handed to code that clones
  selection = $state.raw<Set<GlyphId>>(new Set())
  notices = $state.raw<Notice[]>([])
  busy = $state(false)
  saving = $state(false)
  /**
   * Whether this shell owns persistence.
   *
   * The VSCode editor does not: the extension owns the `.iconotype.json` and writes
   * every edit itself. Left on there, the autosave wrote to the Host's own project
   * store — `/projects/...` through the webview RPC — and failed with EROFS on every
   * keystroke.
   */
  autosave = $state(true)
  building = $state(false)
  embedFont = $state(false)
  formats = $state.raw<FontFormat[]>(['woff2', 'woff', 'ttf'])
  preview = $state.raw<{ family: string; chars: string[]; summary: string } | null>(null)

  // ── fixer ──
  fixSimplify = $state(0)
  fixSnap = $state(0)
  fixRefit = $state(false)
  lint = $state.raw<Map<GlyphId, Finding[]>>(new Map())
  lintFocus = $state.raw<{ glyph: Glyph; before: string[]; after: string[]; findings: Finding[]; height: number } | null>(null)

  // ── quick copy ──
  quickFormat = $state<'character' | 'escape' | 'class' | 'svg' | 'datauri' | 'use' | 'symbol'>('class')
  quickValue = $state('')
  copied = $state(false)

  constructor(session: SessionStore, host: Host, now: () => number) {
    this.session = session
    this.#host = host
    this.#now = now
  }

  // ── derived views ────────────────────────────────────────────────────────────
  /** Sets with their glyphs filtered by the current search. */
  get filteredSets() {
    const q = this.search.trim().toLowerCase()
    return this.session.project.sets.map((set) => ({
      set,
      glyphs: q
        ? set.glyphs.filter((g) =>
            g.name.toLowerCase().includes(q) ||
            g.tags.some((t) => t.toLowerCase().includes(q)) ||
            g.aliases.some((a) => a.toLowerCase().includes(q)))
        : set.glyphs,
    }))
  }

  get matchCount() { return this.filteredSets.reduce((n, s) => n + s.glyphs.length, 0) }
  get selectedGlyphs(): Glyph[] {
    return this.session.project.sets.flatMap((s) => s.glyphs).filter((g) => this.selection.has(g.id))
  }
  codepointOf(glyph: Glyph): number | number[] | undefined { return this.session.project.codepoints[glyph.name] }

  // ── selection ────────────────────────────────────────────────────────────────
  isSelected = (id: GlyphId) => this.selection.has(id)
  toggle(id: GlyphId, additive: boolean) {
    const next = additive ? new Set(this.selection) : new Set<GlyphId>()
    next.has(id) ? next.delete(id) : next.add(id)
    this.selection = next
    if (next.has(id)) void this.focusGlyph(id)
    else if (this.lintFocus?.glyph.id === id) this.lintFocus = null
    void this.#refreshQuick()
  }
  selectAll() { this.selection = new Set(this.filteredSets.flatMap((s) => s.glyphs.map((g) => g.id))) }
  selectNone() { this.selection = new Set() }
  invertSelection() {
    const all = this.filteredSets.flatMap((s) => s.glyphs.map((g) => g.id))
    this.selection = new Set(all.filter((id) => !this.selection.has(id)))
  }

  // ── notices ──────────────────────────────────────────────────────────────────
  notify(kind: Notice['kind'], text: string) {
    this.notices = [...this.notices, { kind, text, at: this.#now() }].slice(-40)
  }
  clearNotices() { this.notices = [] }

  // ── document actions ─────────────────────────────────────────────────────────
  addSet() {
    const id = `${this.session.project.id}-set-${this.session.project.sets.length}-${this.#now()}`
    this.session.do({ t: 'set.add', set: emptySet(id, 'Untitled Set') })
  }
  renameSet(setId: SetId, name: string) { this.session.do({ t: 'set.patch', setId, patch: { name } }) }
  toggleSetHidden(setId: SetId, hidden: boolean) { this.session.do({ t: 'set.patch', setId, patch: { hidden } }) }
  removeSet(setId: SetId) { this.session.do({ t: 'set.remove', setId }) }
  moveSet(setId: SetId, toIndex: number) { this.session.do({ t: 'set.reorder', setId, toIndex }) }
  renameGlyph(id: GlyphId, name: string) { this.session.do({ t: 'glyph.patch', id, patch: { name } }) }

  /**
   * Merges a multicolor glyph into one shape.
   *
   * A multicolor glyph costs one codepoint per layer and renders as a stack of
   * separate characters — which is why `road-cycling` shows as `U+e916 U+e917 U+e918`.
   * Almost every icon that ended up multicolor did so by accident, from an SVG with
   * more than one fill. The FIRST codepoint is kept, so existing references still
   * resolve; the extras are released.
   */
  flattenColors(id: GlyphId) {
    const glyph = this.session.project.sets.flatMap((s) => s.glyphs).find((g) => g.id === id)
    if (!glyph) return
    const code = this.session.project.codepoints[glyph.name]
    this.session.do(
      { t: 'glyph.patch', id, patch: { isMulticolor: false, attrs: glyph.paths.map(() => ({})) } },
      `Flatten ${glyph.name} to one colour`,
    )
    if (Array.isArray(code) && code.length > 1) {
      this.session.do({ t: 'codepoint.assign', assignments: { [glyph.name]: code[0]! } })
    }
  }

  /** Swaps one glyph's artwork for a new SVG, keeping its name, tags and codepoint. */
  async replaceArtwork(id: GlyphId) {
    const glyph = this.session.project.sets.flatMap((s) => s.glyphs).find((g) => g.id === id)
    const set = this.session.project.sets.find((s) => s.glyphs.some((g) => g.id === id))
    if (!glyph || !set) return
    const [file] = await this.#host.pickFiles({ accept: ['.svg'], multiple: false })
    if (!file) return
    try {
      const { importSvg } = await io()
      const result = importSvg(new TextDecoder().decode(file.data), file.name, { targetHeight: set.height })
      this.session.do(
        {
          t: 'glyph.patch',
          id,
          patch: {
            paths: result.glyph.paths,
            attrs: result.glyph.attrs,
            isMulticolor: result.glyph.isMulticolor,
            grid: result.glyph.grid,
          },
        },
        `Replace ${glyph.name} with ${file.name}`,
      )
      this.lint = new Map(this.lint).set(id, result.findings)
      result.warnings.forEach((w) => this.notify('warn', `${file.name}: ${w}`))
      await this.focusGlyph(id)
    } catch (e) {
      this.notify('error', `${file.name}: ${(e as Error).message}`)
    }
  }

  removeSelected() {
    const ids = [...this.selection]
    if (!ids.length) return
    this.session.do({ t: 'glyph.remove', ids })
    this.selectNone()
  }

  moveSelectedTo(setId: SetId) {
    const ids = [...this.selection]
    if (ids.length) this.session.do({ t: 'glyph.move', ids, toSetId: setId })
  }

  /** Adds glyphs and assigns any missing codepoints in one history step. */
  addGlyphs(setId: SetId, glyphs: Glyph[], label?: string) {
    if (!glyphs.length) return
    this.session.do({ t: 'glyph.add', setId, glyphs }, label)
    const { assignments, overflow } = allocate(
      this.session.project,
      // only multicolor glyphs need a codepoint run; extra paths on a monochrome
      // glyph are subpaths of one shape (see core-font/svgfont.ts)
      glyphs.map((g) => ({ name: g.name, layers: g.isMulticolor ? g.paths.length : 1 })),
    )
    if (Object.keys(assignments).length) this.session.do({ t: 'codepoint.assign', assignments })
    if (overflow.length) this.notify('error', `Private Use Area exhausted; no codepoint for: ${overflow.join(', ')}`)
  }

  // ── import ───────────────────────────────────────────────────────────────────
  async importFiles(files: Array<{ name: string; data: Uint8Array }>) {
    this.busy = true
    try {
      for (const f of files) await this.#importOne(f)
    } finally {
      this.busy = false
    }
  }

  /** Imports whatever a URL serves — used by the sample project link. */
  async importUrl(url: string) {
    this.busy = true
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      const name = url.split('/').pop() || 'sample.json'
      await this.#importOne({ name, data: new Uint8Array(await response.arrayBuffer()) })
    } catch (e) {
      this.notify('error', `could not load ${url}: ${(e as Error).message}`)
    } finally {
      this.busy = false
    }
  }

  async pickAndImport() {
    const files = await this.#host.pickFiles({ accept: ['.json', '.zip', '.svg'], multiple: true })
    if (files.length) await this.importFiles(files)
  }

  async #importOne(f: { name: string; data: Uint8Array }) {
    const text = () => new TextDecoder().decode(f.data)
    try {
      if (/\.json$/i.test(f.name)) {
        const { importIcoMoon, isIcoMoonFile, isIconFontFile, fromIconFontFile } = await io()
        const data = JSON.parse(text())

        /**
         * Our own project file counts as importable.
         *
         * It was the one format this refused — you could open an IcoMoon export but
         * not the thing this app writes, which is absurd on its face and worse in
         * practice: the desktop app's Open… accepted it, so the same file worked
         * through one door and not the other.
         */
        if (isIconFontFile(data)) {
          const project = fromIconFontFile(data, this.session.project.id)
          this.session.replace(project, `Open ${f.name}`)
          this.selectNone()
          this.notify('info', `Opened ${f.name}: ${project.sets.reduce((n, s) => n + s.glyphs.length, 0)} icon(s)`)
          return
        }

        if (!isIcoMoonFile(data)) {
          throw new Error('not an Iconotype project, or an IcoMoon project, selection or icon set')
        }
        const { project, warnings } = importIcoMoon(data, { projectId: this.session.project.id })
        this.session.replace(project, `Import ${f.name}`)
        this.selectNone()
        warnings.forEach((w) => this.notify('warn', w))
        this.notify('info', `Imported ${project.sets.length} set(s), ${project.sets.reduce((n, s) => n + s.glyphs.length, 0)} glyph(s) from ${f.name}`)
        return
      }
      if (/\.zip$/i.test(f.name)) {
        const { importIcoMoonZip, importSvgZip } = await io()
        try {
          const { project, warnings } = importIcoMoonZip(f.data, { projectId: this.session.project.id })
          this.session.replace(project, `Import ${f.name}`)
          this.selectNone()
          warnings.forEach((w) => this.notify('warn', w))
          this.notify('info', `Imported IcoMoon package ${f.name}`)
        } catch {
          // not an IcoMoon package — try it as a plain archive of SVGs
          const set = this.#targetSet()
          const { results, glyphs, warnings } = importSvgZip(f.data, { targetHeight: set.height })
          this.addGlyphs(set.id, glyphs, `Import ${glyphs.length} glyph(s) from ${f.name}`)
          const next = new Map(this.lint)
          for (const r of results) next.set(r.glyph.id, r.findings)
          this.lint = next
          warnings.forEach((w) => this.notify('warn', w))
        }
        return
      }
      if (/\.svg$/i.test(f.name)) {
        const { importSvg } = await io()
        const set = this.#targetSet()
        const { glyph, warnings, findings } = importSvg(text(), f.name, { targetHeight: set.height })
        this.addGlyphs(set.id, [glyph])
        // keep what the pipeline reported ON the glyph, so the badge and Fix panel
        // show it instead of it scrolling past as a one-off notice
        this.lint = new Map(this.lint).set(glyph.id, findings)
        warnings.forEach((w) => this.notify('warn', `${f.name}: ${w}`))
        return
      }
      this.notify('error', `${f.name}: unsupported file type (expected .svg, .json or .zip)`)
    } catch (e) {
      this.notify('error', `${f.name}: ${(e as Error).message}`)
    }
  }

  #targetSet() {
    const sets = this.session.project.sets
    if (!sets.length) {
      this.addSet()
      return this.session.project.sets[0]!
    }
    return sets[sets.length - 1]!
  }

  // ── quick copy ───────────────────────────────────────────────────────────────
  setQuickFormat(format: AppStore['quickFormat']) {
    this.quickFormat = format
    void this.#refreshQuick()
  }

  async #refreshQuick() {
    const targets = this.selectedGlyphs.length
      ? this.selectedGlyphs
      : this.lintFocus ? [this.lintFocus.glyph] : []
    if (!targets.length) { this.quickValue = ''; return }

    const kit = await exportkit()
    const entries = kit.iconsOf(this.session.project, new Set(targets.map((g) => g.id)))
    const prefix = this.session.project.preferences.font.prefix
    const lines = entries.map((entry) => {
      switch (this.quickFormat) {
        case 'character': return kit.exportCharacter(this.session.project, entry.glyph)
        case 'escape': return kit.exportEscape(this.session.project, entry.glyph)
        case 'class': return `${prefix}${entry.glyph.name}`
        case 'svg': return kit.exportSvg(entry, { removeNewlines: true })
        case 'datauri': return kit.exportDataUri(entry)
        case 'use': return kit.exportUseSnippet(entry.glyph, { prefix })
        case 'symbol': return kit.exportSymbolSnippet(entry, { prefix })
      }
    })
    this.quickValue = lines.join('\n')
  }

  async copyQuick() {
    if (!this.quickValue) return
    try {
      await this.#host.clipboard.writeText(this.quickValue)
      this.copied = true
      setTimeout(() => { this.copied = false }, 1200)
    } catch (e) {
      this.notify('error', `copy failed: ${(e as Error).message}`)
    }
  }

  // ── fixer ────────────────────────────────────────────────────────────────────
  get #fixOptions() {
    return {
      simplifyTolerance: this.fixSimplify,
      snapGrid: this.fixSnap,
      fit: (this.fixRefit ? 'contain' : 'none') as 'contain' | 'none',
    }
  }

  findingsFor(id: GlyphId): Finding[] | undefined { return this.lint.get(id) }

  get lintSummary() {
    if (!this.lint.size) return null
    let errors = 0, warnings = 0, clean = 0
    for (const findings of this.lint.values()) {
      if (findings.some((f) => f.severity === 'error')) errors++
      else if (findings.some((f) => f.severity === 'warning')) warnings++
      else clean++
    }
    return { errors, warnings, clean }
  }

  #glyphsWithSets() {
    return this.session.project.sets.flatMap((set) => set.glyphs.map((glyph) => ({ set, glyph })))
  }

  /** Runs the geometry half of the pipeline over every glyph and records what it finds. */
  async lintAll() {
    this.busy = true
    try {
      const { fixPaths } = await svgkit()
      const next = new Map<GlyphId, Finding[]>()
      for (const { set, glyph } of this.#glyphsWithSets()) {
        const result = fixPaths(glyph.paths, { ...this.#fixOptions, targetHeight: set.height, attrs: glyph.attrs })
        next.set(glyph.id, result.findings)
      }
      this.lint = next
      const summary = this.lintSummary!
      this.notify('info', `Checked ${next.size} glyph(s): ${summary.errors} error(s), ${summary.warnings} warning(s)`)
    } catch (e) {
      this.notify('error', `check failed: ${(e as Error).message}`)
    } finally {
      this.busy = false
    }
  }

  /** Builds the before/after overlay for one glyph without changing anything. */
  async focusGlyph(id: GlyphId) {
    const hit = this.#glyphsWithSets().find((g) => g.glyph.id === id)
    if (!hit) return
    const { fixPaths } = await svgkit()
    const result = fixPaths(hit.glyph.paths, {
      ...this.#fixOptions, targetHeight: hit.set.height, attrs: hit.glyph.attrs,
    })
    /**
     * Import already ran the full pipeline, so re-linting fixed geometry finds nothing.
     * Those import findings are the interesting ones (what the SVG *had*), so keep them
     * and add anything the current fix settings would additionally do.
     */
    const fromImport = this.lint.get(id) ?? []
    const merged = [...fromImport]
    for (const f of result.findings) if (!merged.some((m) => m.code === f.code)) merged.push(f)
    this.lint = new Map(this.lint).set(id, merged)
    this.lintFocus = {
      glyph: hit.glyph,
      before: hit.glyph.paths,
      after: result.paths,
      findings: merged,
      height: hit.set.height,
    }
  }

  /** Applies the fixer to the selection (or the whole project) as ONE history step. */
  async applyFix() {
    this.busy = true
    try {
      const { fixPaths } = await svgkit()
      const targets = this.selection.size
        ? this.#glyphsWithSets().filter((g) => this.selection.has(g.glyph.id))
        : this.#glyphsWithSets()

      let changed = 0
      const patches: Array<{ id: GlyphId; paths: string[]; attrs: Array<Record<string, string>> }> = []
      const nextLint = new Map(this.lint)
      for (const { set, glyph } of targets) {
        const result = fixPaths(glyph.paths, { ...this.#fixOptions, targetHeight: set.height, attrs: glyph.attrs })
        nextLint.set(glyph.id, result.findings)
        if (result.paths.join() === glyph.paths.join()) continue
        patches.push({ id: glyph.id, paths: result.paths, attrs: result.attrs })
        changed++
      }
      this.lint = nextLint

      if (!changed) {
        this.notify('info', `Nothing to fix in ${targets.length} glyph(s)`)
        return
      }
      // one op per glyph, but grouped under a single label in the history
      patches.forEach((p, i) => {
        this.session.do(
          { t: 'glyph.patch', id: p.id, patch: { paths: p.paths, attrs: p.attrs } },
          i === 0 ? `Fix ${changed} glyph(s)` : `Fix ${changed} glyph(s) (${i + 1}/${changed})`,
        )
      })
      this.notify('info', `Fixed ${changed} of ${targets.length} glyph(s)`)
      if (this.lintFocus) await this.focusGlyph(this.lintFocus.glyph.id)
    } catch (e) {
      this.notify('error', `fix failed: ${(e as Error).message}`)
    } finally {
      this.busy = false
    }
  }

  // ── font build ───────────────────────────────────────────────────────────────
  toggleFormat(f: FontFormat) {
    this.formats = this.formats.includes(f) ? this.formats.filter((x) => x !== f) : [...this.formats, f]
  }

  setFontPref(patch: Partial<FontPrefs>) {
    this.session.do({ t: 'prefs.patch', patch: { font: patch } }, 'Change font settings')
  }

  async downloadBundle() {
    this.building = true
    try {
      const [{ buildBundle }, { exportIcoMoonSelection, writeZip }] = await Promise.all([fontkit(), io()])
      const { files, build } = await buildBundle(this.session.project, {
        formats: this.formats,
        embed: this.embedFont,
        // deterministic stamp: the build must not vary with the wall clock
        timestamp: 0,
        selectionJson: JSON.stringify(exportIcoMoonSelection(this.session.project), null, 2),
      })
      build.warnings.forEach((w) => this.notify('warn', `${w.code}: ${w.message}`))
      const zip = writeZip(files.map((f) => ({ path: f.path, data: f.data })))
      await this.#host.saveAs(`${this.session.project.preferences.font.family}.zip`, zip)
      this.notify('info', `Built ${build.glyphs.length} glyph(s) → ${files.length} file(s), ${(zip.byteLength / 1024).toFixed(1)} kB`)
    } catch (e) {
      this.notify('error', `font build failed: ${(e as Error).message}`)
    } finally {
      this.building = false
    }
  }

  /** Installs the freshly built font in the page so the glyphs can be seen for real. */
  async previewFont() {
    this.building = true
    try {
      const { buildFont } = await fontkit()
      const build = await buildFont(this.session.project, { formats: ['woff2'], timestamp: 0 })
      build.warnings.forEach((w) => this.notify('warn', `${w.code}: ${w.message}`))
      if (!build.woff2) throw new Error('no WOFF2 produced')
      const family = `${this.session.project.preferences.font.family}-preview`
      const face = new FontFace(family, build.woff2.buffer as ArrayBuffer)
      await face.load()
      ;(document.fonts as FontFaceSet).add(face)
      this.preview = {
        family,
        chars: build.glyphs.map((g) => String.fromCodePoint(g.code)),
        summary: `${build.glyphs.length} glyphs · em ${build.metrics.unitsPerEm} · ${(build.woff2.byteLength / 1024).toFixed(1)} kB woff2`,
      }
      this.notify('info', `Preview font installed as "${family}"`)
    } catch (e) {
      this.notify('error', `preview failed: ${(e as Error).message}`)
    } finally {
      this.building = false
    }
  }

  // ── persistence ──────────────────────────────────────────────────────────────
  #save = debounce(() => {
    this.saving = true
    saveProject(this.#host, this.session.project, this.#now())
      .catch((e) => this.notify('error', `save failed: ${(e as Error).message}`))
      .finally(() => { this.saving = false })
  }, 600)

  /** Call from a $effect that reads session.project — autosave on every change. */
  scheduleSave() { if (this.autosave) this.#save() }
}

const APP = Symbol('iconotype.app')
export const setApp = (a: AppStore) => setContext(APP, a)
export const useApp = (): AppStore => {
  const a = getContext<AppStore>(APP)
  if (!a) throw new Error('no AppStore in context')
  return a
}

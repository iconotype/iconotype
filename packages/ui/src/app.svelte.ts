import type { Host } from '@iconotype/core-host'
import { allocate, emptySet, type Glyph, type GlyphId, type IconSet, type OutputConfig, type SetId } from '@iconotype/core-model'
import type { CollectionInfo, IconRef } from '@iconotype/core-io'
import type { FontFormat } from '@iconotype/core-font'
import type { AlignMode, Finding, FlipAxis } from '@iconotype/core-svg'
import type { FontPrefs } from '@iconotype/core-model'
import type { SnippetGroup, SnippetTarget } from '@iconotype/core-export'

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

  // ── layout ──
  /**
   * Which panes are open.
   *
   * A 900px window showed five panes at once and none of them properly. Both rails
   * close, and the mode decides what they contain rather than showing everything
   * always: the export settings are not an answer to any question you have while
   * dragging a glyph two units to the left.
   */
  showSets = $state(true)
  showRail = $state(true)
  showShortcuts = $state(false)
  /**
   * Pane widths, in pixels, dragged by the splitters either side of the grid.
   *
   * A set list of names and a rail of export settings do not want the same width as
   * each other, let alone the same width on a 13" laptop and a 32" display — so they
   * are draggable, clamped to something still usable, and remembered.
   */
  sidebarWidth = $state(220)
  railWidth = $state(320)
  /** how many cells the grid is laying out per row; ↑/↓ move by this much */
  gridColumns = $state(1)
  /** 'system' follows the OS; the other two override it */
  theme = $state<'system' | 'light' | 'dark'>('system')

  /** `browse` is the grid; `edit` is one glyph and nothing else. */
  get mode(): 'browse' | 'edit' { return this.editing ? 'edit' : 'browse' }

  // ── editor ──
  /** the glyph the editor is on, if the shell is showing one */
  editing = $state.raw<GlyphId | null>(null)
  /** editor zoom, 1 = the em box fits the canvas */
  zoom = $state(1)
  /** grid divisions drawn over the em box; 0 hides it */
  editorGrid = $state(16)
  showMetrics = $state(true)

  // ── quick copy ──
  quickFormat = $state<'character' | 'escape' | 'class' | 'svg' | 'datauri' | 'use' | 'symbol'>('class')
  quickValue = $state('')
  copied = $state(false)

  // ── integration snippets ──
  /**
   * "Now what?" — the panel that answers it.
   *
   * A downloaded font is halfway to a working icon; the other half is one paragraph of
   * build config that differs per tool and is nowhere in the export. The snippets are
   * generated from THIS project, so a reader pastes rather than translates.
   */
  showSnippets = $state(false)
  snippetTarget = $state<SnippetTarget>('html')
  snippets = $state.raw<SnippetGroup | null>(null)
  /** the snippet whose Copy was hit, cleared on a timer — one tick per button */
  copiedSnippet = $state<string | null>(null)

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
  /**
   * The glyph the keyboard is on: where a shift-click range starts, and what the
   * arrow keys move. The grid scrolls it back into view when it moves.
   */
  cursor = $state.raw<GlyphId | null>(null)

  toggle(id: GlyphId, additive: boolean) {
    const next = additive ? new Set(this.selection) : new Set<GlyphId>()
    next.has(id) ? next.delete(id) : next.add(id)
    this.selection = next
    this.cursor = id
    if (next.has(id)) void this.focusGlyph(id)
    else if (this.lintFocus?.glyph.id === id) this.lintFocus = null
    void this.#refreshQuick()
  }

  /**
   * Moves the cursor through the grid, in display order.
   *
   * Reviewing a set is "look, next, next" and it should not need the mouse: ←/→ step
   * one, ↑/↓ step a row, and each lands as a fresh single selection so the rail is
   * always answering for the icon you are looking at.
   */
  moveCursor(delta: number) {
    const order = this.filteredSets.flatMap((s) => s.glyphs.map((g) => g.id))
    if (!order.length) return
    const at = this.cursor ? order.indexOf(this.cursor) : -1
    // with nothing under the cursor yet, step in from the end the key came from
    const base = at < 0 ? (delta > 0 ? -1 : order.length) : at
    const next = order[Math.min(order.length - 1, Math.max(0, base + delta))]!
    this.selection = new Set([next])
    this.cursor = next
    void this.focusGlyph(next)
    void this.#refreshQuick()
  }
  selectAll() { this.selection = new Set(this.filteredSets.flatMap((s) => s.glyphs.map((g) => g.id))) }

  /**
   * Extends the selection to a glyph, in display order.
   *
   * Shift-click over a run is how anyone picks "these forty", and without it the only
   * way to build an export set was ⌘-clicking each icon in turn.
   */
  selectTo(id: GlyphId) {
    const order = this.filteredSets.flatMap((s) => s.glyphs.map((g) => g.id))
    const anchor = this.cursor && order.includes(this.cursor) ? this.cursor : order[0]
    const from = order.indexOf(anchor!)
    const to = order.indexOf(id)
    if (from < 0 || to < 0) return
    const [lo, hi] = from <= to ? [from, to] : [to, from]
    this.selection = new Set([...this.selection, ...order.slice(lo, hi + 1)])
  }

  /** Whether an icon ships in the built font — nothing to do with UI selection. */
  isIncluded = (glyph: Glyph) => glyph.selected !== false

  setIncluded(ids: GlyphId[], included: boolean) {
    if (!ids.length) return
    this.session.do({ t: 'glyph.select', ids, selected: included })
  }

  toggleIncluded(glyph: Glyph) { this.setIncluded([glyph.id], glyph.selected === false) }

  /** The selection if there is one, otherwise everything the search matches. */
  #targetIds(): GlyphId[] {
    return this.selection.size
      ? [...this.selection]
      : this.filteredSets.flatMap((s) => s.glyphs.map((g) => g.id))
  }

  includeSelected() { this.setIncluded(this.#targetIds(), true) }
  excludeSelected() { this.setIncluded(this.#targetIds(), false) }

  get includedCount(): number {
    return this.session.project.sets
      .filter((s) => !s.hidden)
      .reduce((n, s) => n + s.glyphs.filter((g) => g.selected !== false).length, 0)
  }
  selectNone() { this.selection = new Set() }
  invertSelection() {
    const all = this.filteredSets.flatMap((s) => s.glyphs.map((g) => g.id))
    this.selection = new Set(all.filter((id) => !this.selection.has(id)))
  }

  // ── editing one glyph ────────────────────────────────────────────────────────

  /** The glyph the editor is on, with the set that gives its coordinate space. */
  get editingGlyph(): { glyph: Glyph; set: { id: SetId; height: number } } | null {
    if (!this.editing) return null
    for (const set of this.session.project.sets) {
      const glyph = set.glyphs.find((g) => g.id === this.editing)
      if (glyph) return { glyph, set: { id: set.id, height: set.height } }
    }
    return null
  }

  /** Every glyph in display order — what next/previous step through. */
  #ordered(): Glyph[] { return this.session.project.sets.flatMap((s) => s.glyphs) }

  edit(id: GlyphId | null) {
    this.editing = id
    if (id) {
      this.selection = new Set([id])
      // leaving the editor should land on the icon you were just editing
      this.cursor = id
      void this.focusGlyph(id)
    }
  }

  /**
   * Moves to the next or previous glyph, wrapping.
   *
   * Editing icons is repetitive work done in a run — fix this one, next, next — so
   * stepping has to be one key, and it has to wrap rather than dead-end at the last
   * one and make you go back to the grid.
   */
  step(delta: 1 | -1) {
    const all = this.#ordered()
    if (!all.length) return
    const at = all.findIndex((g) => g.id === this.editing)
    const next = all[((at < 0 ? 0 : at + delta) + all.length) % all.length]!
    this.edit(next.id)
  }

  get editingIndex(): { index: number; total: number } {
    const all = this.#ordered()
    return { index: all.findIndex((g) => g.id === this.editing) + 1, total: all.length }
  }

  /**
   * One transform, one history step.
   *
   * Every editor action funnels through here so each lands in the timeline with a
   * label that says what it was — "Align hiking left", not "Change glyph".
   */
  async #transform(label: string, apply: (paths: string[], size: number) => string[] | Promise<string[]>) {
    const target = this.editingGlyph
    if (!target) return
    const { glyph, set } = target
    try {
      const paths = await apply(glyph.paths, set.height)
      if (paths === glyph.paths) return
      this.session.do({ t: 'glyph.patch', id: glyph.id, patch: { paths } }, `${label} ${glyph.name}`)
      await this.focusGlyph(glyph.id)
    } catch (e) {
      this.notify('error', `${label} failed: ${(e as Error).message}`)
    }
  }

  async nudge(dx: number, dy: number) {
    const { translatePaths } = await svgkit()
    await this.#transform('Move', (paths) => translatePaths(paths, dx, dy))
  }

  async align(mode: AlignMode) {
    const { alignPaths } = await svgkit()
    await this.#transform(`Align`, (paths, size) => alignPaths(paths, size, mode))
  }

  async flip(axis: FlipAxis) {
    const { flipPaths } = await svgkit()
    await this.#transform('Flip', (paths) => flipPaths(paths, axis))
  }

  async rotate(degrees: number) {
    const { rotatePaths } = await svgkit()
    await this.#transform('Rotate', (paths) => rotatePaths(paths, degrees))
  }

  async scaleBy(factor: number) {
    const { scalePaths } = await svgkit()
    await this.#transform('Scale', (paths) => scalePaths(paths, factor))
  }

  async fitToEm(padding = 0) {
    const { fitToBox } = await svgkit()
    await this.#transform('Fit', (paths, size) => fitToBox(paths, size, padding))
  }

  async mergeOverlaps() {
    const { mergeOverlaps } = await svgkit()
    await this.#transform('Merge overlaps in', (paths) => mergeOverlaps(paths))
  }

  async snapToGrid() {
    const { snapPaths } = await svgkit()
    const grid = this.editorGrid
    await this.#transform('Snap', (paths, size) => snapPaths(paths, grid, size))
  }

  /**
   * Outlines any stroked contour into a filled one.
   *
   * A font glyph has no stroke — only a filled outline — so a stroked path either
   * disappears or renders as a hairline. The importer already does this for SVGs that
   * arrive stroked; this is the same operation for artwork that got here another way.
   */
  async strokeToFill() {
    const target = this.editingGlyph
    if (!target) return
    const { glyph } = target
    const { outlineStroke } = await svgkit()

    const stroked = glyph.attrs
      .map((attr, i) => ({ i, width: Number(attr?.['stroke-width'] ?? 0), stroke: attr?.stroke }))
      .filter((s) => s.stroke && s.stroke !== 'none' && s.width > 0)
    if (!stroked.length) {
      this.notify('info', `${glyph.name} has no stroked paths — its outlines are already filled`)
      return
    }

    const paths = [...glyph.paths]
    const attrs = glyph.attrs.map((a) => ({ ...a }))
    for (const { i, width } of stroked) {
      paths[i] = outlineStroke(paths[i]!, width)
      delete attrs[i]!.stroke
      delete attrs[i]!['stroke-width']
    }
    this.session.do(
      { t: 'glyph.patch', id: glyph.id, patch: { paths, attrs } },
      `Outline strokes in ${glyph.name}`,
    )
    await this.focusGlyph(glyph.id)
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

  // ── icon library ─────────────────────────────────────────────────────────────
  /**
   * Searching the open icon libraries.
   *
   * Every project so far started from artwork you already had. Most do not: you want
   * a chevron and a trash can, and drawing either one is a worse use of an afternoon
   * than finding one somebody already drew. The picker searches 230+ open collections
   * at once and drops the result in as a normal glyph — same pipeline, same codepoint
   * allocation, same undo step.
   *
   * The endpoint is settable so a workspace that cannot reach the public API can point
   * at a self-hosted `iconify/api`; nothing but the query and the icon names is sent.
   */
  showLibrary = $state(false)
  /** what the library should search for the moment it opens, if anything */
  libraryQuery = $state('')
  libraryHost = $state<string | undefined>(undefined)
  adding = $state(false)

  /**
   * Adds icons from a library, one set per collection.
   *
   * The set is per-collection rather than "wherever you happen to be" because a set
   * carries a licence: Lucide's icons are ISC and Font Awesome's are CC BY 4.0, and
   * once they are mixed into one set neither statement is true of it. Kept apart, the
   * font's attribution writes itself.
   */
  async addFromLibrary(refs: IconRef[], collections: Record<string, CollectionInfo>) {
    if (!refs.length) return
    this.adding = true
    try {
      const { fetchIconRefs, toGlyphs, setMetadataFor, iconRefId } = await io()
      const icons = await fetchIconRefs(refs, { host: this.libraryHost })
      const missing = refs.length - icons.length
      if (missing > 0) this.notify('warn', `${missing} icon(s) were not served by the library`)
      if (!icons.length) return

      const taken = new Set(this.session.project.sets.flatMap((s) => s.glyphs).map((g) => g.name))
      const lint = new Map(this.lint)
      let added = 0

      // grouped by collection so each batch lands in one set, in one history step
      const byPrefix = new Map<string, typeof icons>()
      for (const icon of icons) {
        const group = byPrefix.get(icon.prefix)
        if (group) group.push(icon)
        else byPrefix.set(icon.prefix, [icon])
      }

      for (const [prefix, group] of byPrefix) {
        const collection = collections[prefix]
        const set = this.#setForCollection(prefix, collection, setMetadataFor)
        const results = toGlyphs(group, collections, { targetHeight: set.height, taken })
        const glyphs = results.map((r) => r.glyph)
        if (!glyphs.length) continue
        this.addGlyphs(set.id, glyphs, `Add ${glyphs.length} icon(s) from ${collection?.name ?? prefix}`)
        for (const r of results) {
          lint.set(r.glyph.id, r.findings)
          r.warnings.forEach((w) => this.notify('warn', `${iconRefId(r.ref)}: ${w}`))
        }
        added += glyphs.length
      }

      this.lint = lint
      if (added) this.notify('info', `Added ${added} icon(s)`)
    } catch (e) {
      this.notify('error', `icon library: ${(e as Error).message}`)
    } finally {
      this.adding = false
    }
  }

  /**
   * The set a collection's icons belong in, created with its licence if it is new.
   *
   * `metadataFor` is handed in rather than imported: it lives in core-io, and a static
   * import of anything there drags paper.js and the WOFF2 wasm into the boot bundle.
   */
  #setForCollection(
    prefix: string,
    collection: CollectionInfo | undefined,
    metadataFor: (c: CollectionInfo) => IconSet['metadata'],
  ) {
    const name = collection?.name ?? prefix
    const existing = this.session.project.sets.find((s) => s.name === name)
    if (existing) return existing
    const id = `${this.session.project.id}-set-${this.session.project.sets.length}-${this.#now()}`
    const set: IconSet = {
      ...emptySet(id, name),
      metadata: collection ? metadataFor(collection) : {},
    }
    this.session.do({ t: 'set.add', set }, `Add set ${name}`)
    return this.session.project.sets.find((s) => s.id === id) ?? set
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
        const {
          importIcoMoon, isIcoMoonFile, isIconFontFile, fromIconFontFile,
          importSvgNodeProject, isSvgNodeProject,
        } = await io()
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
          this.session.open(project, `Open ${f.name}`)
          this.selectNone()
          this.notify('info', `Opened ${f.name}: ${project.sets.reduce((n, s) => n + s.glyphs.length, 0)} icon(s)`)
          return
        }

        /**
         * An older icon-font project stores each glyph as an already-parsed SVG tree
         * rather than markup, and carries no format marker at all, so it has to be
         * sniffed after the IcoMoon shapes have had their turn.
         */
        if (isSvgNodeProject(data)) {
          const { project, warnings } = importSvgNodeProject(data, {
            projectId: this.session.project.id,
            name: f.name.replace(/\.json$/i, ''),
            targetHeight: this.#targetSet().height,
          })
          this.session.open(project, `Import ${f.name}`)
          this.selectNone()
          warnings.forEach((w) => this.notify('warn', w))
          this.notify('info', `Imported ${project.sets[0]!.glyphs.length} glyph(s) from ${f.name}`)
          return
        }

        if (!isIcoMoonFile(data)) {
          throw new Error('not an Iconotype project, or an IcoMoon project, selection or icon set')
        }
        const { project, warnings } = importIcoMoon(data, { projectId: this.session.project.id })
        this.session.open(project, `Import ${f.name}`)
        this.selectNone()
        warnings.forEach((w) => this.notify('warn', w))
        this.notify('info', `Imported ${project.sets.length} set(s), ${project.sets.reduce((n, s) => n + s.glyphs.length, 0)} glyph(s) from ${f.name}`)
        return
      }
      if (/\.zip$/i.test(f.name)) {
        const { importIcoMoonZip, importSvgZip } = await io()
        try {
          const { project, warnings } = importIcoMoonZip(f.data, { projectId: this.session.project.id })
          this.session.open(project, `Import ${f.name}`)
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

  async openSnippets() {
    this.showSnippets = true
    await this.#loadSnippets()
  }

  async setSnippetTarget(target: SnippetTarget) {
    this.snippetTarget = target
    await this.#loadSnippets()
  }

  async #loadSnippets() {
    try {
      const kit = await exportkit()
      this.snippets = kit.buildSnippets(this.session.project, this.snippetTarget)
    } catch (e) {
      this.notify('error', `could not build the snippets: ${(e as Error).message}`)
    }
  }

  async copySnippet(id: string, text: string) {
    try {
      await this.#host.clipboard.writeText(text)
      this.copiedSnippet = id
      setTimeout(() => { if (this.copiedSnippet === id) this.copiedSnippet = null }, 1200)
    } catch (e) {
      this.notify('error', `copy failed: ${(e as Error).message}`)
    }
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
      /**
       * What "fix" means depends on where you are: the glyph you are editing, then
       * the selection, then everything. Running the whole project from inside the
       * editor would be a surprise measured in hundreds of glyphs.
       */
      const targets = this.editing
        ? this.#glyphsWithSets().filter((g) => g.glyph.id === this.editing)
        : this.selection.size
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

  /**
   * Where a build writes its files.
   *
   * Committed with the project rather than held in the app, because the CLI and the
   * VSCode extension build the same project and must land in the same places.
   */
  setOutput(patch: OutputConfig) {
    this.session.do({ t: 'output.patch', patch }, 'Change output paths')
  }

  async downloadBundle() {
    this.building = true
    try {
      const [{ buildBundle }, { exportIcoMoonSelection, writeZip }, { snippetsMarkdown }] =
        await Promise.all([fontkit(), io(), exportkit()])
      const { files, build } = await buildBundle(this.session.project, {
        formats: this.formats,
        embed: this.embedFont,
        // deterministic stamp: the build must not vary with the wall clock
        timestamp: 0,
        selectionJson: JSON.stringify(exportIcoMoonSelection(this.session.project), null, 2),
      })
      build.warnings.forEach((w) => this.notify('warn', `${w.code}: ${w.message}`))
      // the integration notes ship with the files they are about
      files.push({ path: 'USAGE.md', data: snippetsMarkdown(this.session.project) })
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

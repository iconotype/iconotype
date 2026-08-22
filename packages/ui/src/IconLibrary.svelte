<script lang="ts">
  import { onMount } from 'svelte'
  import { useApp } from './app.svelte.js'
  import type { CollectionInfo, IconRef } from '@iconotype/core-io'

  /**
   * The library browser.
   *
   * Two rules shape this. First, previews render in an `<img>` fed a data URI, never
   * with `{@html}`: the markup comes from a third-party API, and an `<img>` cannot run
   * a script or fetch anything no matter what is inside it. Second, licences are shown
   * next to the results rather than buried — you are about to ship somebody's work in
   * your font, and CC BY 4.0 asks something of you that ISC does not.
   */
  let { onClose }: { onClose: () => void } = $props()

  const app = useApp()

  let query = $state('')
  /** empty = every collection; otherwise only these prefixes are searched */
  let chosenPrefixes = $state.raw<Set<string>>(new Set())
  let collectionFilter = $state('')
  let filterOpen = $state(false)
  let loading = $state(false)
  let error = $state('')
  let icons = $state.raw<IconRef[]>([])
  let total = $state(0)
  let collections = $state.raw<Record<string, CollectionInfo>>({})
  let allCollections = $state.raw<CollectionInfo[]>([])
  let svgs = $state.raw<Map<string, string>>(new Map())
  let picked = $state.raw<Set<string>>(new Set())

  const LIMIT = 96
  const refId = (r: IconRef) => `${r.prefix}:${r.name}`

  /**
   * `currentColor` inside an `<img>` has no inherited colour to resolve against, so a
   * stroke set would render black on a dark theme — invisible. The `color` attribute
   * on the root gives it one; read from the theme so it follows light and dark.
   */
  let ink = $state('#888')
  function readInk() {
    const value = getComputedStyle(document.documentElement).getPropertyValue('--gs-fg').trim()
    if (value) ink = value
  }

  const dataUri = (svg: string) =>
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace('<svg ', `<svg color="${ink}" `))}`

  let timer: ReturnType<typeof setTimeout> | undefined
  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(run, 250)
  }

  let generation = 0
  async function run() {
    const mine = ++generation
    const q = query.trim()
    if (!q) { icons = []; total = 0; error = ''; return }
    loading = true
    error = ''
    try {
      const { searchIcons, fetchIconRefs } = await import('@iconotype/core-io')
      const result = await searchIcons(q, {
        limit: LIMIT,
        prefixes: chosenPrefixes.size ? [...chosenPrefixes] : undefined,
        host: app.libraryHost,
      })
      // a slower earlier keystroke must never overwrite a newer result
      if (mine !== generation) return
      icons = result.icons
      total = result.total
      collections = result.collections

      const artwork = await fetchIconRefs(result.icons, { host: app.libraryHost })
      if (mine !== generation) return
      svgs = new Map(artwork.map((a) => [refId(a), a.svg]))
      /*
       * The index can list an icon the artwork endpoint will not serve — a hidden
       * alias, usually. Left in, it showed as an empty cell with a name under it, and
       * picking it added nothing. Dropped, what you see is what you get.
       */
      if (artwork.length !== result.icons.length) icons = result.icons.filter((r) => svgs.has(refId(r)))
    } catch (e) {
      if (mine === generation) error = (e as Error).message
    } finally {
      if (mine === generation) loading = false
    }
  }

  onMount(() => {
    readInk()
    ;(document.querySelector('.library input[type=search]') as HTMLInputElement | null)?.focus()
    // the full collection list is one 95 kB request; only worth it once the picker opens
    void (async () => {
      try {
        const { listCollections } = await import('@iconotype/core-io')
        const all = await listCollections({ host: app.libraryHost })
        allCollections = Object.values(all).sort((a, b) => a.name.localeCompare(b.name))
      } catch { /* the filter is a convenience; search works without it */ }
    })()
    return () => clearTimeout(timer)
  })

  const titleFor = (ref: IconRef) => {
    const licence = collections[ref.prefix]?.license?.title
    return `${refId(ref)}${licence ? ` · ${licence}` : ''}`
  }

  function toggle(ref: IconRef) {
    const next = new Set(picked)
    const id = refId(ref)
    if (!next.delete(id)) next.add(id)
    picked = next
  }

  async function add() {
    const chosen = icons.filter((r) => picked.has(refId(r)))
    await app.addFromLibrary(chosen, collections)
    onClose()
  }

  /**
   * Licences for what you have actually picked.
   *
   * Showing them for everything on screen listed forty collections and swallowed half
   * the dialog — and none of it applied to you, because you were taking two icons. The
   * ones you selected are the ones whose terms you are about to be bound by.
   */
  const shown = $derived(
    [...new Set(icons.filter((r) => picked.has(refId(r))).map((r) => r.prefix))]
      .map((p) => collections[p])
      .filter(Boolean) as CollectionInfo[],
  )

  /**
   * Results grouped by collection.
   *
   * A search across everything returns ninety-six near-identical chevrons from thirty
   * libraries, and picking one means knowing which library it came from — a caption
   * under each cell is not enough to compare them. Grouped, each library's take on the
   * icon sits together and its licence is stated once, above its own icons. Insertion
   * order is kept, so the collections the API ranked highest stay at the top.
   */
  const groups = $derived.by(() => {
    const out = new Map<string, IconRef[]>()
    for (const ref of icons) {
      const group = out.get(ref.prefix)
      if (group) group.push(ref)
      else out.set(ref.prefix, [ref])
    }
    return [...out].map(([prefix, refs]) => ({ prefix, refs, collection: collections[prefix] }))
  })

  const filteredCollections = $derived.by(() => {
    const needle = collectionFilter.trim().toLowerCase()
    if (!needle) return allCollections
    return allCollections.filter(
      (c) => c.name.toLowerCase().includes(needle) || c.prefix.includes(needle),
    )
  })

  function togglePrefix(prefix: string) {
    const next = new Set(chosenPrefixes)
    if (!next.delete(prefix)) next.add(prefix)
    chosenPrefixes = next
    void run()
  }

  function clearPrefixes() {
    chosenPrefixes = new Set()
    void run()
  }

  const filterLabel = $derived(
    chosenPrefixes.size === 0
      ? 'All collections'
      : chosenPrefixes.size === 1
        ? (collections[[...chosenPrefixes][0]!]?.name ??
           allCollections.find((c) => c.prefix === [...chosenPrefixes][0])?.name ??
           [...chosenPrefixes][0]!)
        : `${chosenPrefixes.size} collections`,
  )

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && picked.size) void add()
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="scrim library">
  <button class="backdrop" aria-label="Close" onclick={onClose}></button>
  <div class="card" role="dialog" aria-label="Icon library">
    <header>
      <h2>Icon library</h2>
      <span class="muted">230+ open collections, searched at once</span>
      <span class="spacer"></span>
      <button class="ghost icon" onclick={onClose} title="Close (esc)">×</button>
    </header>

    <div class="controls">
      <input
        type="search"
        placeholder="Search every library — home, arrow, trash…"
        bind:value={query}
        oninput={schedule}
      />
      <!--
        A popover, not a <select>.
        A native select picks exactly one out of 236 with no way to search it — so
        narrowing to "Lucide and Tabler" was impossible, and finding either meant
        scrolling a list the length of a phone book.
      -->
      <div class="filter">
        <button
          class="ghost"
          class:on={chosenPrefixes.size > 0}
          aria-expanded={filterOpen}
          onclick={() => (filterOpen = !filterOpen)}
        >{filterLabel} ▾</button>

        {#if filterOpen}
          <button class="backdrop bare" aria-label="Close" onclick={() => (filterOpen = false)}></button>
          <div class="menu">
            <div class="menu-head">
              <input
                type="search"
                placeholder="Filter collections…"
                bind:value={collectionFilter}
              />
              <button class="ghost tiny" disabled={!chosenPrefixes.size} onclick={clearPrefixes}>Clear</button>
            </div>
            <div class="menu-list">
              {#if !allCollections.length}
                <p class="muted pad">loading the collection list…</p>
              {/if}
              {#each filteredCollections as c (c.prefix)}
                <label class="row">
                  <input
                    type="checkbox"
                    checked={chosenPrefixes.has(c.prefix)}
                    onchange={() => togglePrefix(c.prefix)}
                  />
                  <span class="row-name">{c.name}</span>
                  <span class="muted row-count">{c.total}</span>
                </label>
              {/each}
              {#if allCollections.length && !filteredCollections.length}
                <p class="muted pad">No collection matches “{collectionFilter}”.</p>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    </div>

    {#if error}
      <p class="error">{error}</p>
    {:else if loading}
      <p class="muted state">searching…</p>
    {:else if !query.trim()}
      <p class="muted state">Type to search Lucide, Material Symbols, MDI, Tabler, Phosphor and 200+ more.</p>
    {:else if !icons.length}
      <p class="muted state">Nothing matched “{query}”.</p>
    {/if}

    {#if icons.length}
      <div class="results">
        {#each groups as group (group.prefix)}
          <!--
            One heading per collection, carrying its licence.
            Stated here it is stated once, next to the icons it governs, instead of
            once per cell in a tooltip nobody opens.
          -->
          <h3 class="group">
            <span>{group.collection?.name ?? group.prefix}</span>
            <span class="muted">{group.refs.length}</span>
            {#if group.collection?.license?.title}
              <a
                class="muted licence"
                href={group.collection.license.url ?? group.collection.author?.url ?? '#'}
                target="_blank"
                rel="noreferrer noopener"
              >{group.collection.license.title}</a>
            {/if}
          </h3>
          {#each group.refs as ref (refId(ref))}
            {@const id = refId(ref)}
            {@const svg = svgs.get(id)}
            <!--
              A label around a checkbox, not a button.
              Chrome sizes a <button> from its own line box rather than its children, so
              the cell came out 35px tall and clipped both labels no matter what the
              inner layout said. A checkbox is also what this control actually is —
              multi-select — so screen readers get "checked" for free.
            -->
            <label class="cell" class:on={picked.has(id)} title={titleFor(ref)}>
              <input
                type="checkbox"
                checked={picked.has(id)}
                onchange={() => toggle(ref)}
              />
              <span class="art">
                {#if svg}<img src={dataUri(svg)} alt="" width="24" height="24" />{/if}
              </span>
              <span class="name">{ref.name}</span>
            </label>
          {/each}
        {/each}
      </div>
    {/if}

    <footer>
      {#if shown.length}
        <span class="licences">
          <span class="muted">You will be shipping:</span>
          {#each shown as c (c.prefix)}
            <a href={c.license?.url ?? c.author?.url ?? '#'} target="_blank" rel="noreferrer noopener">
              {c.name} · {c.license?.title ?? 'see source'}
            </a>
          {/each}
        </span>
      {/if}
      <span class="spacer"></span>
      {#if total > icons.length}<span class="muted">{icons.length} of {total}</span>{/if}
      <button class="ghost" onclick={onClose}>Cancel</button>
      <button disabled={!picked.size || app.adding} onclick={add}>
        {app.adding ? 'Adding…' : picked.size ? `Add ${picked.size}` : 'Add'}
      </button>
    </footer>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; }
  /*
   * The hover rule has to be here.
   * `button:hover:not(:disabled)` in the theme is more specific than a bare `.backdrop`,
   * so the invisible click-catcher lit up accent-purple the moment the pointer left the
   * dialog — the whole page flashing violet as you moved the mouse away.
   */
  .backdrop, .backdrop:hover { position: absolute; inset: 0; background: rgba(0, 0, 0, .45); border: 0; cursor: default; }
  .card {
    position: relative; width: min(880px, 92vw); height: min(620px, 86vh);
    display: grid; grid-template-rows: auto auto 1fr auto; gap: 12px;
    padding: 16px; border-radius: var(--gs-radius-lg); border: 1px solid var(--gs-border);
    background: var(--gs-surface); box-shadow: var(--gs-shadow, 0 20px 60px rgba(0, 0, 0, .4));
  }
  header, footer, .controls { display: flex; align-items: center; gap: 8px; }
  h2 { margin: 0; font-size: calc(var(--gs-size) + 2px); }
  .spacer { flex: 1; }
  .muted { color: var(--gs-muted); font-size: var(--gs-size-sm); }
  .error { color: var(--gs-error); font-size: var(--gs-size-sm); margin: 0; }
  .state { place-self: center; margin: 0; text-align: center; max-width: 40ch; }
  .icon { padding: 2px 8px; }

  .controls input[type='search'] { flex: 1; }

  /* the collection filter: a button that opens a searchable checklist */
  .filter { position: relative; flex: 0 0 auto; }
  .filter > .ghost.on { border-color: var(--gs-accent); color: var(--gs-accent); }
  .filter .backdrop.bare { position: fixed; z-index: 1; background: transparent; }
  .filter .backdrop.bare:hover { background: transparent; }
  .menu {
    position: absolute; top: calc(100% + 6px); right: 0; z-index: 2;
    width: 280px; max-height: 320px; display: flex; flex-direction: column;
    border: 1px solid var(--gs-border); border-radius: var(--gs-radius-lg);
    background: var(--gs-surface-2); box-shadow: var(--gs-shadow, 0 8px 24px rgba(0, 0, 0, .3));
  }
  .menu-head { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid var(--gs-border); }
  .menu-head input { flex: 1; min-width: 0; }
  .menu-list { overflow-y: auto; padding: 4px; }
  .tiny { padding: 2px 8px; font-size: var(--gs-size-sm); }
  .pad { padding: 10px; margin: 0; }
  .row {
    display: flex; align-items: center; gap: 8px; padding: 4px 6px;
    border-radius: var(--gs-radius); cursor: pointer; font-size: var(--gs-size-sm);
  }
  .row:hover { background: var(--gs-hover); }
  .row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row-count { font-variant-numeric: tabular-nums; }

  /*
   * The grid scrolls; the header, search and footer never move.
   *
   * `grid-auto-rows: min-content` is load-bearing. Left to `auto`, ninety-six results
   * in a fixed-height track had their rows shrunk to fit the box instead of
   * overflowing it — every cell clipped to its artwork, both labels gone, and nothing
   * to scroll. `min-height: 0` is the other half: a grid item will not shrink below
   * its content unless told it may.
   */
  .results {
    overflow-y: auto; align-content: start; grid-auto-rows: min-content;
    min-height: 0; scrollbar-gutter: stable;
    display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 6px;
    padding: 2px;
  }
  /* a full-width heading inside the same grid, so the columns stay aligned under it */
  .group {
    grid-column: 1 / -1; display: flex; align-items: baseline; gap: 8px;
    margin: 10px 0 2px; padding: 0 2px 4px; border-bottom: 1px solid var(--gs-border);
    font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
  }
  .group:first-child { margin-top: 0; }
  .group .muted { font-size: 10px; text-transform: none; letter-spacing: 0; }
  .licence { margin-left: auto; text-decoration: none; }
  .licence:hover { color: var(--gs-accent); text-decoration: underline; }

  .cell {
    display: grid; gap: 2px; justify-items: center; padding: 8px 4px;
    border: 1px solid transparent; border-radius: var(--gs-radius);
    cursor: pointer; overflow: hidden; min-width: 0;
  }
  /* focusable and announced, but the cell itself is the target you click */
  .cell input {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip-path: inset(50%); white-space: nowrap;
  }
  .cell:focus-within { border-color: var(--gs-accent); box-shadow: var(--gs-ring); }
  .cell:hover { background: var(--gs-hover); }
  .cell.on { background: var(--gs-active); border-color: var(--gs-accent); }
  .art { display: grid; place-items: center; width: 32px; height: 32px; }
  .art img { width: 24px; height: 24px; }
  /* the collection is named by the section heading now, so the cell only needs the icon's own name */
  .name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }

  /*
   * The licences are the point of showing them, so they are links to the actual terms
   * rather than a string you would have to go looking up.
   */
  .licences { display: flex; flex-wrap: wrap; gap: 8px; min-width: 0; }
  .licences a { color: var(--gs-muted); font-size: 10px; text-decoration: none; }
  .licences a:hover { color: var(--gs-accent); text-decoration: underline; }
</style>

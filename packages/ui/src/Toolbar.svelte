<script lang="ts">
  import Icon from './Icon.svelte'
  import RecentsMenu from './RecentsMenu.svelte'
  import type { RecentProject } from './recents.js'
  import { useApp } from './app.svelte.js'

  /**
   * The one row of actions, under the title bar.
   *
   * File actions on the left and history on the right stay put whatever the shell is
   * doing; the selection and search controls between them belong to the grid and are
   * gone while the editor is open, where they would act on something you cannot see.
   */
  let {
    onOpen,
    onSave,
    onSaveAs,
    onPickRecent,
    home,
  }: {
    onOpen?: () => void
    onSave?: () => void
    onSaveAs?: () => void
    onPickRecent?: (entry: RecentProject) => void
    home?: string
  } = $props()

  const app = useApp()
  const session = $derived(app.session)
  const undoLabel = $derived(session.canUndo ? `Undo ${session.timeline.at(-1)?.label ?? ''}` : 'Nothing to undo')
  const redoLabel = $derived(session.canRedo ? 'Redo' : 'Nothing to redo')
</script>

<div class="bar">
  {#if onOpen}
    <button class="ghost" onclick={onOpen} title="Open a project file (⌘O)">Open…</button>
  {/if}
  {#if onPickRecent}<RecentsMenu onPick={onPickRecent} {home} />{/if}
  {#if onSave}
    <button class="ghost" onclick={onSave} title="Save to the project file (⌘S)">Save</button>
  {/if}
  {#if onSaveAs}
    <button class="ghost" onclick={onSaveAs} title="Save to a new file (⇧⌘S)">Save as…</button>
  {/if}

  {#if app.mode === 'browse'}
    <span class="sep"></span>
    <button onclick={() => app.pickAndImport()} disabled={app.busy}>Import…</button>
    <button
      class="ghost"
      onclick={() => (app.showLibrary = true)}
      title="Search Lucide, Material Symbols, MDI and 200+ other open libraries (⌘K)"
    >Find icons…</button>

    <label class="size" title="Glyph size: {app.cellSize}px">
      <input type="range" min="16" max="96" step="8" bind:value={app.cellSize} aria-label="Glyph size" />
    </label>

    <input class="search" type="search" placeholder="Search name or tag… (/)" bind:value={app.search} />
    <span class="muted count" title="{app.matchCount} shown · {app.includedCount} in font">
      {app.matchCount} / {app.includedCount}
    </span>

    <span class="spacer"></span>

    <!--
      Fixed positions, always. These used to swap: "Select all" sat where "Remove"
      appears the moment anything is selected, so all/none/all landed on Remove instead —
      a destructive action under a button you were clicking rhythmically.
    -->
    {#if app.selection.size}<span class="muted">{app.selection.size} selected</span>{/if}
    <button class="ghost" onclick={() => app.selectAll()} disabled={!app.matchCount}>All</button>
    <button class="ghost" onclick={() => app.selectNone()} disabled={!app.selection.size}>None</button>
    <button class="ghost" onclick={() => app.invertSelection()} disabled={!app.matchCount}>Invert</button>
    <span class="sep"></span>
    <!--
      Include/exclude is what decides the built font; it acts on the selection, or on
      everything the search matches when nothing is selected — which is how you take a
      900-icon set down to the twelve you need.
    -->
    <button
      class="ghost"
      onclick={() => app.includeSelected()}
      title={app.selection.size ? `Include the ${app.selection.size} selected` : 'Include everything shown'}
    >Include</button>
    <button
      class="ghost"
      onclick={() => app.excludeSelected()}
      title={app.selection.size ? `Exclude the ${app.selection.size} selected` : 'Exclude everything shown'}
    >Exclude</button>

    {#if app.selection.size}
      <span class="sep"></span>
      <button class="ghost danger" onclick={() => app.removeSelected()}>
        Remove {app.selection.size}
      </button>
    {/if}
  {:else}
    <span class="spacer"></span>
  {/if}

  <span class="sep"></span>
  <button class="ghost icon" disabled={!session.canUndo} onclick={() => session.undo()} title={undoLabel} aria-label={undoLabel}>
    <Icon name="undo" />
  </button>
  <button class="ghost icon" disabled={!session.canRedo} onclick={() => session.redo()} title={redoLabel} aria-label={redoLabel}>
    <Icon name="redo" />
  </button>
</div>

<style>
  /*
   * One row where it fits, wrapping where it does not.
   *
   * Everything here is one line of text; without `nowrap` the flex line squeezed
   * "Find icons…" into two lines of three characters rather than moving it down.
   */
  .bar {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
    padding: 6px 12px; border-bottom: 1px solid var(--gs-border);
  }
  /* a dozen buttons in one row: tighter than a dialog's, still a comfortable target */
  .bar :global(button) { white-space: nowrap; padding: 4px 9px; }
  .spacer { flex: 1; }
  .muted { color: var(--gs-muted); font-size: 12px; white-space: nowrap; }
  .count { font-variant-numeric: tabular-nums; }
  input[type='search'] {
    font: inherit; background: var(--gs-input); color: var(--gs-fg);
    border: 1px solid var(--gs-border); border-radius: var(--gs-radius); padding: 3px 8px; min-width: 150px;
  }
  .size { display: flex; align-items: center; gap: 6px; }
  .size input { width: 78px; }
  .icon { display: grid; place-items: center; padding: 5px; }
  .danger:hover { border-color: var(--gs-error); color: var(--gs-error); }
  /* keeps the destructive button visibly out of the rhythm of the selection controls */
  .sep { width: 1px; align-self: stretch; margin: 2px 4px; background: var(--gs-border); }
</style>

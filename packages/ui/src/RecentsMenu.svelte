<script lang="ts">
  import { onMount } from 'svelte'
  import { useHost } from './session.svelte.js'
  import { folderOf, forgetRecent, listRecents, type RecentProject } from './recents.js'

  /**
   * The recent-projects menu.
   *
   * A shell that can reopen something passes `onPick`; the entries themselves come
   * from the shared store, so the desktop and the web app show the same list in the
   * same place without either implementing it.
   */
  let { onPick, home }: { onPick: (entry: RecentProject) => void; home?: string } = $props()

  const host = useHost()
  let open = $state(false)
  let entries = $state<RecentProject[]>([])

  const refresh = async () => { entries = await listRecents(host) }

  onMount(() => { void refresh() })

  const pick = (entry: RecentProject) => {
    open = false
    onPick(entry)
  }
</script>

<div class="wrap">
  <button
    class="ghost"
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={async () => { if (!open) await refresh(); open = !open }}
    title="Recently opened projects"
  >
    Recent
  </button>

  {#if open}
    <!-- click anywhere else closes it; the backdrop is what makes that work without
         a document listener that outlives the component -->
    <button class="backdrop" aria-label="Close" onclick={() => { open = false }}></button>
    <div class="menu" role="menu">
      {#each entries as entry (entry.path ?? entry.id)}
        <div class="item">
          <button class="pick" role="menuitem" onclick={() => pick(entry)} title={entry.path ?? entry.name}>
            <span class="name">{entry.name}</span>
            <span class="folder">{folderOf(entry, home)}</span>
          </button>
          <button
            class="forget"
            title="Forget this one"
            onclick={async () => { entries = await forgetRecent(host, entry) }}
          >×</button>
        </div>
      {:else}
        <p class="empty">Nothing opened yet.</p>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wrap { position: relative; display: inline-flex; }
  /*
   * `:hover` included deliberately: `button:hover:not(:disabled)` in the theme outranks
   * a bare `.backdrop`, so this invisible click-catcher turned the whole window
   * accent-purple as soon as the pointer left the menu.
   */
  .backdrop, .backdrop:hover { position: fixed; inset: 0; z-index: 20; background: transparent; border: 0; cursor: default; }
  .menu {
    position: absolute; top: calc(100% + 6px); right: 0; z-index: 21; min-width: 260px; max-width: 420px;
    padding: 4px; border-radius: var(--gs-radius-lg); border: 1px solid var(--gs-border);
    background: var(--gs-surface-2); box-shadow: var(--gs-shadow, 0 8px 24px rgba(0,0,0,.3));
  }
  .item { display: flex; align-items: stretch; gap: 2px; }
  .pick {
    flex: 1; min-width: 0; display: grid; gap: 1px; text-align: left;
    background: transparent; color: var(--gs-fg); border: 0; padding: 5px 8px; border-radius: var(--gs-radius);
  }
  .pick:hover, .forget:hover { background: var(--gs-hover); }
  .name { font-size: var(--gs-size); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* the folder is the part that actually tells two projects apart, so keep its tail */
  .folder {
    font-size: var(--gs-size-sm); color: var(--gs-muted); font-family: var(--gs-mono);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left;
  }
  .forget { background: transparent; color: var(--gs-muted); border: 0; padding: 0 8px; border-radius: var(--gs-radius); }
  .empty { margin: 0; padding: 8px; font-size: var(--gs-size-sm); color: var(--gs-muted); }
</style>

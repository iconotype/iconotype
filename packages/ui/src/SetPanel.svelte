<script lang="ts">
  import { useApp } from './app.svelte.js'
  const app = useApp()
  let editing = $state<string | null>(null)
</script>

<aside>
  <h2>Sets <button class="ghost tiny" onclick={() => app.addSet()} title="Add set">+</button></h2>
  <ul>
    {#each app.session.project.sets as set, i (set.id)}
      <li class:hidden={set.hidden}>
        <input
          type="checkbox"
          checked={!set.hidden}
          title={set.hidden ? 'Set excluded from the font' : 'Set included in the font'}
          onchange={(e) => app.toggleSetHidden(set.id, !e.currentTarget.checked)}
        />
        {#if editing === set.id}
          <input
            class="rename"
            value={set.name}
            onblur={(e) => { app.renameSet(set.id, e.currentTarget.value); editing = null }}
            onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') editing = null }}
          />
        {:else}
          <button class="name" ondblclick={() => { editing = set.id }} title="Double-click to rename">
            {set.name}<span class="muted"> {set.glyphs.length}</span>
          </button>
        {/if}
        <button class="ghost tiny" disabled={i === 0} onclick={() => app.moveSet(set.id, i - 1)} title="Move up">↑</button>
        <button class="ghost tiny" disabled={i === app.session.project.sets.length - 1} onclick={() => app.moveSet(set.id, i + 1)} title="Move down">↓</button>
        <button class="ghost tiny" onclick={() => app.removeSet(set.id)} title="Remove set">×</button>
      </li>
    {/each}
  </ul>

  {#if app.selection.size}
    <h2>Move {app.selection.size} to…</h2>
    <ul>
      {#each app.session.project.sets as set (set.id)}
        <li><button class="name" onclick={() => app.moveSelectedTo(set.id)}>{set.name}</button></li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
  aside { border-right: 1px solid var(--gs-border); padding: 10px; overflow: auto; }
  h2 { display: flex; align-items: center; gap: 6px; font-size: 11px; text-transform: uppercase;
       letter-spacing: .06em; color: var(--gs-muted); margin: 4px 0 8px; }
  ul { list-style: none; margin: 0 0 14px; padding: 0; display: grid; gap: 2px; }
  li { display: flex; align-items: center; gap: 4px; }
  .hidden .name { opacity: .5; text-decoration: line-through; }
  .name { flex: 1; text-align: left; background: transparent; color: var(--gs-fg); border: none;
          padding: 3px 6px; border-radius: 3px; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name:hover { background: var(--gs-hover); }
  .muted { color: var(--gs-muted); }
  .tiny { padding: 0 5px; font-size: 11px; line-height: 18px; }
  .rename { flex: 1; font: inherit; font-size: 12px; background: var(--vscode-input-background, #14141a);
            color: var(--gs-fg); border: 1px solid var(--gs-accent); border-radius: 3px; padding: 2px 5px; }
</style>

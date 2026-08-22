<script lang="ts">
  import { useApp } from './app.svelte.js'
  const app = useApp()
  let open = $state(true)
</script>

{#if app.notices.length}
  <div class="notices" class:collapsed={!open}>
    <header>
      <button class="ghost tiny" onclick={() => (open = !open)}>{open ? '▾' : '▸'}</button>
      <strong>{app.notices.length} message(s)</strong>
      <span class="spacer"></span>
      <button class="ghost tiny" onclick={() => app.clearNotices()}>Clear</button>
    </header>
    {#if open}
      <ul>
        {#each app.notices as n (n.at + n.text)}
          <li class={n.kind}>{n.text}</li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .notices { border-top: 1px solid var(--gs-border); max-height: 30vh; display: flex; flex-direction: column; }
  header { display: flex; align-items: center; gap: 6px; padding: 4px 10px; font-size: 12px; }
  .spacer { flex: 1; }
  ul { list-style: none; margin: 0; padding: 0 10px 8px; overflow: auto; font-size: 12px; font-family: var(--gs-mono); }
  li { padding: 1px 0; color: var(--gs-muted); }
  li.warn { color: var(--gs-warn); }
  li.error { color: var(--gs-error); }
  .tiny { padding: 0 5px; font-size: 11px; }
</style>

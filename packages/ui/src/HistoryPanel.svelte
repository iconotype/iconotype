<script lang="ts">
  import { useSession } from './session.svelte.js'
  const session = useSession()
</script>

<aside>
  <h2>History</h2>
  <ol>
    {#each session.timeline as node, i (node.id)}
      <li>
        <button class="entry" class:current={node.current} onclick={() => session.goto(node.id)}>
          <span class="n">{i === 0 ? '' : i + '.'}</span>{node.label}
        </button>
        {#if node.branchCount > 0}<span class="branch" title="alternative branches">⑂{node.branchCount}</span>{/if}
      </li>
    {/each}
  </ol>

  {#if session.branches.length}
    <h2>Branches</h2>
    <ul>
      {#each session.branches as b (b.from.id)}
        {#each b.alternatives as alt (alt.id)}
          <li><button class="entry" onclick={() => session.goto(alt.id)}>⑂ {alt.label}</button></li>
        {/each}
      {/each}
    </ul>
  {/if}
</aside>

<style>
  aside { border-left: 1px solid var(--gs-border); padding: 12px; overflow: auto; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--gs-muted); margin: 4px 0 8px; }
  ol, ul { list-style: none; margin: 0 0 16px; padding: 0; }
  li { display: flex; align-items: center; gap: 4px; }
  .entry {
    flex: 1; text-align: left; background: transparent; color: var(--gs-fg);
    border: none; padding: 3px 6px; border-radius: 3px; font-size: 12px;
  }
  .entry:hover { background: var(--gs-hover); }
  .current { background: var(--gs-active); }
  .n { color: var(--gs-muted); display: inline-block; min-width: 16px; }
  .branch { color: var(--gs-muted); font-size: 11px; }
</style>

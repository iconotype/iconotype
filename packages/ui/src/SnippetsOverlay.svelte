<script lang="ts">
  /**
   * How to use the font you just built.
   *
   * The export gives you files; this gives you the twenty lines of build config nobody
   * writes down, per tool, with this project's family, class prefix, output paths and
   * real codepoints already in them. Targets down the left because the list will keep
   * growing, and the reader only ever wants one of them.
   */
  import { SNIPPET_TARGETS, type SnippetTarget } from '@iconotype/core-export'
  import CodeBlock from './CodeBlock.svelte'
  import { useApp } from './app.svelte.js'

  let { onClose }: { onClose: () => void } = $props()
  const app = useApp()

  /** the targets, in the order they are declared, under their group heading */
  const groups = SNIPPET_TARGETS.reduce<Array<{ name: string; targets: typeof SNIPPET_TARGETS }>>(
    (acc, target) => {
      const last = acc[acc.length - 1]
      if (last && last.name === target.group) last.targets.push(target)
      else acc.push({ name: target.group, targets: [target] })
      return acc
    },
    [],
  )

  const pick = (id: SnippetTarget) => void app.setSnippetTarget(id)
</script>

<div class="scrim">
  <button class="backdrop" aria-label="Close" onclick={onClose}></button>
  <div class="card" role="dialog" aria-label="Using this font">
    <header>
      <h2>Using {app.session.project.preferences.font.family}</h2>
      <p class="muted">Generated from this project — the paths, class names and codepoints are the real ones.</p>
      <button class="ghost close" onclick={onClose} aria-label="Close">Close</button>
    </header>

    <nav>
      {#each groups as group}
        <h3>{group.name}</h3>
        {#each group.targets as target}
          <button
            class="target"
            class:active={app.snippetTarget === target.id}
            aria-pressed={app.snippetTarget === target.id}
            onclick={() => pick(target.id)}
          >{target.label}</button>
        {/each}
      {/each}
    </nav>

    <section class="body">
      {#if app.snippets}
        <p class="blurb">{app.snippets.blurb}</p>
        {#each app.snippets.snippets as snippet (snippet.id)}
          <article>
            <div class="row">
              <strong>{snippet.label}</strong>
              {#if snippet.file}<code class="file">{snippet.file}</code>{/if}
              <span class="spacer"></span>
              <button class="ghost" onclick={() => app.copySnippet(snippet.id, snippet.code)}>
                {app.copiedSnippet === snippet.id ? 'Copied' : 'Copy'}
              </button>
            </div>
            <CodeBlock code={snippet.code} lang={snippet.lang} />
            {#if snippet.note}<p class="note">{snippet.note}</p>{/if}
          </article>
        {/each}
      {:else}
        <p class="muted">Building the snippets…</p>
      {/if}
    </section>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; }
  /* see ShortcutsOverlay: the theme's button:hover beats a bare class selector */
  .backdrop, .backdrop:hover { position: absolute; inset: 0; background: rgba(0, 0, 0, .45); border: 0; cursor: default; }
  .card {
    position: relative; width: min(920px, 92vw); height: min(700px, 86vh);
    display: grid; grid-template-columns: 170px 1fr; grid-template-rows: auto 1fr;
    gap: 0; border-radius: var(--gs-radius-lg); border: 1px solid var(--gs-border);
    background: var(--gs-surface); box-shadow: var(--gs-shadow, 0 20px 60px rgba(0,0,0,.4));
    overflow: hidden;
  }
  header {
    grid-column: 1 / -1; display: flex; align-items: baseline; gap: 10px;
    padding: 14px 16px; border-bottom: 1px solid var(--gs-border);
  }
  h2 { margin: 0; font-size: calc(var(--gs-size) + 2px); }
  h3 {
    margin: 10px 0 4px; font-size: 10px; text-transform: uppercase;
    letter-spacing: .07em; color: var(--gs-muted);
  }
  .close { margin-left: auto; }
  nav { padding: 6px 8px 12px; border-right: 1px solid var(--gs-border); overflow: auto; }
  .target {
    display: block; width: 100%; text-align: left; background: transparent;
    border: 1px solid transparent; border-radius: var(--gs-radius);
    color: var(--gs-fg); padding: 3px 8px; font-size: var(--gs-size-sm);
  }
  .target.active { background: var(--gs-active); border-color: var(--gs-accent); color: var(--gs-fg); }
  .body { overflow: auto; padding: 14px 16px; display: grid; gap: 14px; align-content: start; }
  .blurb { margin: 0; color: var(--gs-muted); font-size: var(--gs-size-sm); }
  article { display: grid; gap: 6px; }
  .row { display: flex; align-items: center; gap: 8px; }
  .spacer { flex: 1; }
  .file { font-family: var(--gs-mono); font-size: 10px; color: var(--gs-muted); }
  .note { margin: 0; color: var(--gs-muted); font-size: var(--gs-size-sm); line-height: 1.5; }
  .muted { color: var(--gs-muted); font-size: var(--gs-size-sm); margin: 0; }
  @media (max-width: 760px) {
    .card { grid-template-columns: 1fr; grid-template-rows: auto auto 1fr; }
    nav { border-right: 0; border-bottom: 1px solid var(--gs-border); display: flex; flex-wrap: wrap; gap: 4px; }
    nav h3 { display: none; }
    .target { width: auto; }
  }
</style>

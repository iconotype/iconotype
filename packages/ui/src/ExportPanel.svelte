<script lang="ts">
  import type { FontFormat } from '@iconotype/core-font'
  import OutputSettings from './OutputSettings.svelte'
  import QuickExport from './QuickExport.svelte'
  import { useApp } from './app.svelte.js'

  const app = useApp()
  const ALL: FontFormat[] = ['woff2', 'woff', 'ttf', 'svg']
</script>

<aside>
  <h2>Export</h2>

  <fieldset>
    <legend>Formats</legend>
    {#each ALL as f}
      <label>
        <input
          type="checkbox"
          checked={app.formats.includes(f)}
          onchange={() => app.toggleFormat(f)}
        />
        {f}
      </label>
    {/each}
  </fieldset>

  <label class="row">
    <input type="checkbox" bind:checked={app.embedFont} />
    inline font as data URI
  </label>

  <label class="row stack">
    <span>Font family</span>
    <input
      value={app.session.project.preferences.font.family}
      onchange={(e) => app.setFontPref({ family: e.currentTarget.value })}
    />
  </label>

  <label class="row stack">
    <span>Class prefix</span>
    <input
      value={app.session.project.preferences.font.prefix}
      onchange={(e) => app.setFontPref({ prefix: e.currentTarget.value })}
    />
  </label>

  <label class="row stack">
    <span>Em size</span>
    <input
      type="number" min="16" max="4096" step="16"
      value={app.session.project.preferences.font.emSize}
      onchange={(e) => app.setFontPref({ emSize: Number(e.currentTarget.value) })}
    />
  </label>

  <div class="actions">
    <button onclick={() => app.downloadBundle()} disabled={app.building || !app.session.glyphCount}>
      {app.building ? 'Building…' : 'Download package'}
    </button>
    <button class="ghost" onclick={() => app.previewFont()} disabled={app.building || !app.session.glyphCount}>
      Preview font
    </button>
    <!-- the files are half the answer; this is the other half -->
    <button class="ghost" onclick={() => app.openSnippets()}>
      How to use it
    </button>
  </div>

  <OutputSettings />

  <h2>Quick copy</h2>
  <QuickExport />

  {#if app.preview}
    <div class="preview">
      <p class="muted">Rendered with the generated font:</p>
      <div class="sample" style:font-family={app.preview.family}>
        {#each app.preview.chars as c}<span>{c}</span>{/each}
      </div>
      <p class="muted">{app.preview.summary}</p>
    </div>
  {/if}
</aside>

<style>
  aside { border-left: var(--gs-divider); padding: 10px; overflow: auto; display: grid; gap: 10px; align-content: start; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--gs-muted); margin: 4px 0 0; }
  fieldset { border: 1px solid var(--gs-border); border-radius: var(--gs-radius); padding: 6px 8px; margin: 0; display: flex; flex-wrap: wrap; gap: 8px; }
  legend { font-size: 10px; color: var(--gs-muted); text-transform: uppercase; letter-spacing: .05em; }
  label { font-size: 12px; display: flex; align-items: center; gap: 5px; }
  .stack { flex-direction: column; align-items: stretch; gap: 3px; }
  .stack span { color: var(--gs-muted); font-size: 11px; }
  input[type='number'], .stack input {
    font: inherit; font-size: 12px; background: var(--gs-input);
    color: var(--gs-fg); border: 1px solid var(--gs-border); border-radius: var(--gs-radius); padding: 3px 6px; width: 100%;
  }
  .actions { display: grid; gap: 6px; }
  .preview { border-top: 1px solid var(--gs-border); padding-top: 8px; }
  .sample { font-size: 26px; line-height: 1.6; word-break: break-all; }
  .muted { color: var(--gs-muted); font-size: 11px; margin: 2px 0; }
</style>

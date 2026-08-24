<script lang="ts">
  /**
   * Where a build writes its files.
   *
   * Folded away by default: a project that only ever downloads a zip never needs any
   * of it, and a project wired into a build needs it exactly once. Every location is a
   * comma-separated list, because the same stylesheet or font often has to exist in
   * more than one place — two apps in a monorepo, or a framework that wants the font
   * under `public/` and the source tree both.
   */
  import {
    formatPathList, parsePathList, toPaths,
    type FontsOutput, type StyleOutput, type StyleOutputKind,
  } from '@iconotype/core-model'
  import { useApp } from './app.svelte.js'

  const app = useApp()
  const output = $derived(app.session.project.output ?? {})

  const KINDS: Array<{ id: StyleOutputKind; label: string }> = [
    { id: 'css', label: 'CSS' },
    { id: 'scss', label: 'SCSS' },
    { id: 'less', label: 'LESS' },
    { id: 'scss-variables', label: 'SCSS variables' },
    { id: 'less-variables', label: 'LESS variables' },
    { id: 'css-variables', label: 'CSS variables' },
    { id: 'json', label: 'JSON map' },
    { id: 'dart', label: 'Dart (Flutter)' },
  ]
  const FORMATS: Array<FontsOutput['formats'][number]> = ['woff2', 'woff', 'ttf', 'svg']

  const fonts = (): FontsOutput => output.fonts ?? { dir: 'fonts', formats: ['woff2', 'woff', 'ttf'] }

  const setFontDirs = (value: string) => {
    const dirs = parsePathList(value).map((d) => d.replace(/\/+$/, ''))
    if (!dirs.length) return app.setOutput({ fonts: undefined })
    app.setOutput({ fonts: { ...fonts(), dir: toPaths(dirs) } })
  }

  const setPublicPath = (value: string) => {
    const publicPath = value.trim()
    app.setOutput({ fonts: { ...fonts(), publicPath: publicPath || undefined } })
  }

  const toggleFormat = (format: FontsOutput['formats'][number]) => {
    const current = fonts().formats
    const next = current.includes(format) ? current.filter((f) => f !== format) : [...current, format]
    app.setOutput({ fonts: { ...fonts(), formats: next } })
  }

  const styles = $derived(output.styles ?? [])

  const patchStyle = (index: number, patch: Partial<StyleOutput>) => {
    const next = styles.map((s, i) => (i === index ? { ...s, ...patch } : s))
    app.setOutput({ styles: next })
  }
  const setStylePaths = (index: number, value: string) => {
    const paths = parsePathList(value)
    // an emptied field removes the output rather than writing to nowhere
    if (!paths.length) return app.setOutput({ styles: styles.filter((_, i) => i !== index) })
    patchStyle(index, { path: toPaths(paths) })
  }
  const addStyle = () =>
    app.setOutput({
      styles: [...styles, { kind: 'css', path: `css/${app.session.project.preferences.font.family}.css` }],
    })
  const removeStyle = (index: number) => app.setOutput({ styles: styles.filter((_, i) => i !== index) })

  /** the single-file outputs, which differ only in what they hold */
  const singles = [
    { key: 'types' as const, label: 'Type declarations', placeholder: 'types/icons.d.ts' },
    { key: 'sprite' as const, label: 'SVG sprite', placeholder: 'assets/sprite.svg' },
    { key: 'demo' as const, label: 'Demo page', placeholder: 'demo.html' },
  ]
  const setSingle = (key: 'types' | 'sprite' | 'demo', value: string) => {
    const paths = parsePathList(value)
    app.setOutput({ [key]: paths.length ? { path: toPaths(paths) } : undefined })
  }
</script>

<details class="advanced">
  <summary>Advanced — build output</summary>

  <p class="hint">
    Where <code>iconotype build</code>, the VSCode extension and any CI run write. Several
    locations per line, separated by commas.
  </p>

  <label class="stack">
    <span>Fonts directory</span>
    <input
      value={formatPathList(output.fonts?.dir)}
      placeholder="app/fonts, public/fonts"
      onchange={(e) => setFontDirs(e.currentTarget.value)}
    />
  </label>

  <fieldset>
    <legend>Formats written</legend>
    {#each FORMATS as format}
      <label>
        <input
          type="checkbox"
          checked={(output.fonts?.formats ?? []).includes(format)}
          onchange={() => toggleFormat(format)}
        />
        {format}
      </label>
    {/each}
  </fieldset>

  <label class="stack">
    <span>Font URL in the stylesheet</span>
    <input
      value={output.fonts?.publicPath ?? ''}
      placeholder="computed from the first stylesheet"
      onchange={(e) => setPublicPath(e.currentTarget.value)}
    />
  </label>

  <div class="group">
    <div class="row">
      <span class="label">Stylesheets</span>
      <button class="ghost small" onclick={addStyle}>Add</button>
    </div>
    {#if !styles.length}
      <p class="hint">None — a build writes font files only.</p>
    {/if}
    {#each styles as style, i}
      <div class="row">
        <select value={style.kind} onchange={(e) => patchStyle(i, { kind: e.currentTarget.value as StyleOutputKind })}>
          {#each KINDS as kind}<option value={kind.id}>{kind.label}</option>{/each}
        </select>
        <input
          class="grow"
          value={formatPathList(style.path)}
          placeholder="app/css/icons.css"
          onchange={(e) => setStylePaths(i, e.currentTarget.value)}
        />
        <button class="ghost small" onclick={() => removeStyle(i)} aria-label="Remove this stylesheet">×</button>
      </div>
    {/each}
  </div>

  {#each singles as single}
    <label class="stack">
      <span>{single.label}</span>
      <input
        value={formatPathList(output[single.key]?.path)}
        placeholder={single.placeholder}
        onchange={(e) => setSingle(single.key, e.currentTarget.value)}
      />
    </label>
  {/each}
</details>

<style>
  .advanced { border-top: 1px solid var(--gs-border); padding-top: 8px; margin-top: 4px; }
  summary { cursor: default; font-size: var(--gs-size-sm); color: var(--gs-muted); user-select: none; }
  summary::marker { color: var(--gs-muted); }
  .advanced[open] > summary { margin-bottom: 8px; color: var(--gs-fg); }
  .hint { margin: 0 0 8px; color: var(--gs-muted); font-size: 11px; line-height: 1.45; }
  .stack { display: grid; gap: 3px; margin-bottom: 8px; font-size: var(--gs-size-sm); }
  .group { display: grid; gap: 6px; margin-bottom: 8px; }
  /* a 200px rail cannot hold a select, a path and a remove button on one line */
  .row { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .label { font-size: var(--gs-size-sm); }
  .row .grow { flex: 1 1 120px; min-width: 0; }
  .row > .ghost { margin-left: auto; }
  .row .grow ~ .ghost { margin-left: 0; }
  .small { padding: 1px 6px; font-size: 11px; }
  input, select { width: 100%; }
  select { width: auto; }
  fieldset {
    border: 1px solid var(--gs-border); border-radius: var(--gs-radius);
    padding: 4px 8px 6px; margin: 0 0 8px; display: flex; flex-wrap: wrap; gap: 8px;
  }
  legend { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--gs-muted); }
  fieldset label { display: flex; align-items: center; gap: 3px; font-size: var(--gs-size-sm); }
  fieldset input { width: auto; }
  code { font-family: var(--gs-mono); font-size: 10px; }
</style>

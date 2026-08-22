/**
 * Shared build constraints. Every bundler config in this repo MUST use these.
 * Each one exists because a spike proved what breaks without it — see /spikes.
 */
import type { Plugin } from 'vite'

/**
 * CONSTRAINT 1 — single paper.js instance.
 *
 * `paperjs-offset` does `import paper from 'paper'` and type-guards with
 * `path instanceof paper.Path`. Import `paper/dist/paper-core.js` anywhere else and
 * you get a SECOND paper instance, so every offset call throws
 * "Offset source must be a Paper.js Path or CompoundPath".
 *
 * Aliasing globally also drops the PaperScript compiler: −147 KB raw / −49 KB gzip.
 *
 * IMPORTANT: apply this in BUNDLERS ONLY, never in vitest/node. Under node, deps are
 * externalized and resolved by node itself, so an alias rewrites our imports but not
 * paperjs-offset's — manufacturing the very two-instance bug it exists to prevent.
 * Node hosts (CLI, vscode extension host) simply let both resolve to 'paper' natively,
 * which is already a single instance.
 */
export const paperAlias = { paper: 'paper/dist/paper-core.js' } as const

/**
 * CONSTRAINT 5 — nothing inline in webview output.
 *
 * A strict `style-src` (no 'unsafe-inline') is only possible because Svelte 5 emits
 * a linked stylesheet and animates via WAAPI. One inline <style> silently forces the
 * CSP open again, so fail the build instead.
 */
export function assertNoInlineAssets(): Plugin {
  return {
    name: 'glyphsmith:assert-no-inline-assets',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      for (const [file, chunk] of Object.entries(bundle)) {
        if (!file.endsWith('.html') || chunk.type !== 'asset') continue
        const html = String(chunk.source)
        const inlineStyle = /<style(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/style>/i.test(html)
        const inlineScript = /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(html)
        if (inlineStyle || inlineScript) {
          this.error(
            `${file} contains inline ${inlineStyle ? '<style>' : ''}${inlineStyle && inlineScript ? ' and ' : ''}` +
              `${inlineScript ? '<script>' : ''}. That breaks the strict webview CSP ` +
              `(see spikes/02-svelte-vscode-webview). Emit linked assets instead ` +
              `(vite: build.cssCodeSplit / assetsInlineLimit: 0).`,
          )
        }
      }
    },
  }
}

/** Vite build options that keep output CSP-safe in every host. */
export const cspSafeBuild = {
  cssCodeSplit: false,
  assetsInlineLimit: 0,
  modulePreload: { polyfill: false },
} as const

/**
 * CONSTRAINT 3 — the webview CSP we ship.
 * `strict` is the ideal; `relaxed` adds ONLY the two relaxations spike 02 proved mandatory:
 *   - 'wasm-unsafe-eval'  → without it WebAssembly.instantiate throws, i.e. no WOFF2
 *   - worker-src blob:    → without it blob Workers are blocked
 * Note there is NO 'unsafe-inline' in style-src. Keep it that way.
 */
export function webviewCsp(cspSource: string, nonce: string, mode: 'strict' | 'relaxed' = 'relaxed'): string {
  const base = [
    `default-src 'none'`,
    `img-src ${cspSource} data: blob:`,
    `style-src ${cspSource}`,
    `font-src ${cspSource}`,
  ]
  /**
   * `'strict-dynamic'` is what lets the nonced entry script pull in its own chunks.
   *
   * The app code-splits (paper.js and the WOFF2 wasm are loaded on demand), and a
   * dynamically imported chunk cannot carry a nonce — the browser fetches it, not the
   * document. Without this the import is refused and surfaces as "Failed to fetch
   * dynamically imported module", which reads like a missing file rather than a policy.
   */
  const rest =
    mode === 'strict'
      ? [`script-src 'nonce-${nonce}' 'strict-dynamic'`, `connect-src ${cspSource}`]
      : [
          `script-src 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'`,
          `connect-src ${cspSource} blob: data:`,
          `worker-src blob:`,
        ]
  return [...base, ...rest].join('; ') + ';'
}

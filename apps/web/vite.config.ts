import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { assertNoInlineAssets, cspSafeBuild, paperAlias } from '@glyphsmith/build-config'

// GitHub Pages serves from /<repo>/ — override with BASE_PATH in CI.
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [svelte(), assertNoInlineAssets()],
  resolve: { alias: { ...paperAlias } },
  build: { ...cspSafeBuild, target: 'es2022', sourcemap: true },
})

import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

/**
 * NOTE: deliberately NO paper alias here.
 *
 * The alias exists for BUNDLED browser builds, where Vite processes every module and
 * both our code and paperjs-offset resolve to the same paper-core. Under vitest (node)
 * deps are externalized and resolved by Node, so an alias would apply to OUR source but
 * not to paperjs-offset — manufacturing the exact two-instance bug it prevents.
 *
 * Rule: alias in bundlers, never in node. packages/core-svg/test/constraints.test.ts
 * asserts single-instance identity so a regression here fails loudly.
 */
export default defineConfig({
  // compiles .svelte.ts rune modules so the stores are testable outside a browser
  plugins: [svelte({ compilerOptions: { runes: true } })],
  test: {
    globals: true,
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
  },
})

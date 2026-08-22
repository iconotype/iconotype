import { defineConfig } from 'vite'

/**
 * The product page.
 *
 * No framework: it is one document, and every kilobyte of JavaScript here is a
 * kilobyte spent before anyone has seen what the thing does. `BASE_PATH` matches the
 * Pages subpath, and the app is deployed underneath it at `app/`.
 */
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  build: { target: 'es2022', assetsDir: 'assets' },
})

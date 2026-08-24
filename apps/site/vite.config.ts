import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

/**
 * The demo loop, served from where it is recorded.
 *
 * `docs/media` is the one copy of these files — the README points at them and so does
 * this page. Copying them into `public/` would put a second megabyte of binary in the
 * repository that silently goes stale the next time the video is re-cut, so they are
 * served from there in dev and emitted at build instead.
 */
const media = (files: string[]): Plugin => {
  const read = (name: string) =>
    readFileSync(fileURLToPath(new URL(`../../docs/media/${name}`, import.meta.url)))
  const TYPES: Record<string, string> = {
    mp4: 'video/mp4', jpg: 'image/jpeg', gif: 'image/gif', png: 'image/png',
  }
  return {
    name: 'iconotype-media',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = files.find((f) => req.url?.split('?')[0].endsWith(`/${f}`))
        if (!name) return next()
        res.setHeader('content-type', TYPES[name.split('.').pop()!] ?? 'application/octet-stream')
        res.end(read(name))
      })
    },
    generateBundle() {
      for (const name of files) this.emitFile({ type: 'asset', fileName: name, source: read(name) })
    },
  }
}

/**
 * The product page.
 *
 * No framework: it is one document, and every kilobyte of JavaScript here is a
 * kilobyte spent before anyone has seen what the thing does. `BASE_PATH` matches the
 * Pages subpath, and the app is deployed underneath it at `app/`.
 */
export default defineConfig({
  plugins: [media(['demo.mp4', 'demo-poster.jpg', 'social-preview.png'])],
  base: process.env.BASE_PATH ?? '/',
  build: { target: 'es2022', assetsDir: 'assets' },
})

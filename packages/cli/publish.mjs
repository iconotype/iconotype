import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

/**
 * Assembles the npm package.
 *
 * The workspace manifest cannot be published as it stands: its `@iconotype/*`
 * dependencies are `workspace:*`, which means nothing outside this repository, and its
 * name is scoped to an org that does not need to exist for `npx iconotype` to work.
 *
 * The bundle already contains every one of our own modules (see build.mjs), so those
 * dependencies vanish; the third-party ones stay, because they are external for
 * reasons the build script explains.
 */
const version = process.argv[2] ?? '0.0.0'
const source = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

execFileSync('node', ['build.mjs'], { cwd: new URL('.', import.meta.url), stdio: 'inherit' })

const out = new URL('./dist-npm/', import.meta.url)
rmSync(out, { recursive: true, force: true })
mkdirSync(new URL('./bin/', out), { recursive: true })

const dependencies = Object.fromEntries(
  Object.entries(source.dependencies).filter(([name]) => !name.startsWith('@iconotype/')),
)

writeFileSync(new URL('./package.json', out), JSON.stringify({
  name: 'iconotype',
  version,
  description: 'Build, fix and export icon fonts. Imports IcoMoon projects.',
  license: 'MIT',
  type: 'commonjs',
  bin: { iconotype: './bin/iconotype.cjs' },
  files: ['bin'],
  engines: { node: '>=20' },
  repository: { type: 'git', url: 'git+https://github.com/mguillon/iconotype.git' },
  keywords: ['icon-font', 'icomoon', 'svg', 'woff2', 'webfont', 'icons'],
  dependencies,
}, null, 2) + '\n')

cpSync(new URL('./bin/iconotype.cjs', import.meta.url), new URL('./bin/iconotype.cjs', out))
cpSync(new URL('../../LICENSE', import.meta.url), new URL('./LICENSE', out))
writeFileSync(new URL('./README.md', out), readFileSync(new URL('./README.npm.md', import.meta.url), 'utf8'))

console.log(`packages/cli/dist-npm ready — iconotype@${version}`)

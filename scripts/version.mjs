#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Cuts a version across the whole repository.
 *
 * One version number lives in five places — the root manifest, the extension, the Tauri
 * config, the Rust crate, and the npm package assembled at publish time — and they have
 * to agree, because a release is one thing even though it ships as four. This is the
 * only writer.
 *
 *   node scripts/version.mjs --bump minor
 *   node scripts/version.mjs --bump test --dry
 *
 * `test` cuts a prerelease: `0.3.0-test.1`, then `-test.2`, and so on. The VSCode
 * marketplace refuses a semver prerelease suffix, so the extension gets the plain
 * `x.y.z` and is published with `--pre-release` instead; that mapping lives here so the
 * workflow never has to reason about it.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`)
  return at < 0 ? fallback : args[at + 1]
}
const dry = args.includes('--dry')
const bump = flag('bump', 'patch')
if (!['patch', 'minor', 'major', 'test'].includes(bump)) {
  console.error(`unknown bump "${bump}" — expected patch, minor, major or test`)
  process.exit(1)
}

const git = (...a) =>
  execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'))

const current = readJson('package.json').version || '0.0.0'
const parsed = /^(\d+)\.(\d+)\.(\d+)(?:-test\.(\d+))?$/.exec(current)
if (!parsed) {
  console.error(`the root version "${current}" is not one this script wrote`)
  process.exit(1)
}
const [major, minor, patch, test] = parsed.slice(1).map((n) => (n === undefined ? undefined : Number(n)))

const next = (() => {
  switch (bump) {
    case 'major': return `${major + 1}.0.0`
    case 'minor': return `${major}.${minor + 1}.0`
    case 'patch': return test ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`
    // a second test build continues the same prerelease rather than starting a new one
    case 'test': return test ? `${major}.${minor}.${patch}-test.${test + 1}` : `${major}.${minor}.${patch + 1}-test.1`
  }
})()
const release = next.replace(/-test\.\d+$/, '')

// ── the changelog, from conventional commits ─────────────────────────────────────

const previousTag = (() => {
  try { return git('describe', '--tags', '--abbrev=0') } catch { return '' }
})()

const range = previousTag ? `${previousTag}..HEAD` : 'HEAD'
const commits = git('log', range, '--no-merges', '--pretty=%H%x00%s%x00%b%x01')
  .split('\x01')
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const [sha, subject, body = ''] = entry.split('\x00')
    const parsedSubject = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(subject) ?? []
    return {
      sha: sha.slice(0, 7),
      type: parsedSubject[1] ?? 'other',
      scope: parsedSubject[2] ?? '',
      breaking: Boolean(parsedSubject[3]) || /BREAKING[ -]CHANGE/.test(body),
      summary: parsedSubject[4] ?? subject,
    }
  })

const sections = [
  ['Breaking', commits.filter((c) => c.breaking)],
  ['Features', commits.filter((c) => c.type === 'feat' && !c.breaking)],
  ['Fixes', commits.filter((c) => c.type === 'fix' && !c.breaking)],
  ['Performance', commits.filter((c) => c.type === 'perf' && !c.breaking)],
  ['Other', commits.filter((c) => !c.breaking && !['feat', 'fix', 'perf'].includes(c.type))],
]

const notes = sections
  .filter(([, entries]) => entries.length)
  .map(([title, entries]) => [
    `### ${title}`,
    '',
    ...entries.map((c) => `- ${c.scope ? `**${c.scope}:** ` : ''}${c.summary} (${c.sha})`),
    '',
  ].join('\n'))
  .join('\n') || '_No conventional commits since the last release._\n'

// ── write it everywhere ──────────────────────────────────────────────────────────

const edits = []

const patchJson = (path, apply) => {
  const file = join(root, path)
  if (!existsSync(file)) return
  const data = JSON.parse(readFileSync(file, 'utf8'))
  apply(data)
  edits.push([path, JSON.stringify(data, null, 2) + '\n'])
}

patchJson('package.json', (d) => { d.version = next })
patchJson('apps/desktop/package.json', (d) => { d.version = next })
// the marketplace takes no prerelease suffix; `--pre-release` is the channel instead
patchJson('apps/vscode/package.json', (d) => { d.version = release })
patchJson('apps/desktop/src-tauri/tauri.conf.json', (d) => { d.version = next })

const cargoPath = 'apps/desktop/src-tauri/Cargo.toml'
const cargo = readFileSync(join(root, cargoPath), 'utf8')
edits.push([cargoPath, cargo.replace(/^version = ".*"$/m, `version = "${next}"`)])

const changelogPath = 'CHANGELOG.md'
const existing = existsSync(join(root, changelogPath))
  ? readFileSync(join(root, changelogPath), 'utf8').replace(/^# Changelog\n+/, '')
  : ''
const stamp = new Date(Number(git('log', '-1', '--pretty=%ct')) * 1000).toISOString().slice(0, 10)
edits.push([changelogPath, `# Changelog\n\n## ${next} — ${stamp}\n\n${notes}\n${existing}`])

if (dry) {
  console.log(JSON.stringify({ current, next, release, previousTag, files: edits.map(([p]) => p) }, null, 2))
  console.log(`\n${notes}`)
} else {
  for (const [path, contents] of edits) writeFileSync(join(root, path), contents)
}

// the workflow reads these
if (process.env.GITHUB_OUTPUT) {
  writeFileSync(process.env.GITHUB_OUTPUT, [
    `version=${next}`,
    `release=${release}`,
    `tag=v${next}`,
    `prerelease=${next.includes('-test.') ? 'true' : 'false'}`,
    `notes<<NOTES\n${notes}\nNOTES`,
    '',
  ].join('\n'), { flag: 'a' })
}

console.error(`${current} → ${next}${dry ? ' (dry run)' : ''}`)

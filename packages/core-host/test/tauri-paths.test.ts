import { describe, expect, it, vi } from 'vitest'

/**
 * The Tauri plugins only exist inside a Tauri window, so they are stubbed. What is
 * under test is the path rule, which is pure and decides where every write lands.
 */
vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 13 },
  exists: vi.fn(), mkdir: vi.fn(), readDir: vi.fn(), readFile: vi.fn(), readTextFile: vi.fn(),
  remove: vi.fn(), watch: vi.fn(), writeFile: vi.fn(), writeTextFile: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ readText: vi.fn(), writeText: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ appDataDir: vi.fn(), basename: vi.fn(), join: vi.fn() }))

const { isAbsolutePath, scope } = await import('../src/tauri.js')

describe('desktop path scoping', () => {
  it('keeps the app\'s own storage inside the app data directory', () => {
    // what persistence.ts writes — the same relative layout the web host keeps in OPFS
    expect(scope('projects/p0/project.json')).toEqual({ baseDir: 13 })
    expect(scope('projects')).toEqual({ baseDir: 13 })
  })

  it('leaves a path the user chose exactly where they chose it', () => {
    expect(scope('/Users/me/code/app.iconotype.json')).toEqual({})
    expect(scope('C:\\Users\\me\\app.iconotype.json')).toEqual({})
    expect(scope('D:/work/app.iconotype.json')).toEqual({})
  })

  it('recognises both absolute forms', () => {
    expect(isAbsolutePath('/tmp/x')).toBe(true)
    expect(isAbsolutePath('C:\\tmp\\x')).toBe(true)
    expect(isAbsolutePath('projects/x')).toBe(false)
    expect(isAbsolutePath('./projects/x')).toBe(false)
  })
})

import * as vscode from 'vscode'
import type { OutputConfig, StyleOutputKind } from '@glyphsmith/core-model'
import { defaultOutputConfig, outputConfigFor } from '@glyphsmith/core-export/layout'
import type { OutputFile } from '@glyphsmith/core-export'
import { heavy } from './lazy.js'
import type { IconFont, IconFontRegistry } from './registry.js'

/**
 * Quick export: font files and stylesheets written straight into the project, where the
 * bundler already looks for them. No zip, no download, no manual unpacking.
 */

export interface ExportResult {
  font: IconFont
  written: OutputFile[]
  glyphCount: number
  skipped?: string
}

const workspaceRoot = (font: IconFont): vscode.Uri =>
  vscode.workspace.getWorkspaceFolder(font.uri)?.uri
  ?? vscode.Uri.joinPath(font.uri, '..')

/** Falls back to the workspace settings, then to a sensible default layout. */
export function resolveOutputConfig(font: IconFont): OutputConfig {
  if (font.project.output) return font.project.output

  const settings = vscode.workspace.getConfiguration('glyphsmith', font.uri)
  const fontsDir = settings.get<string>('defaults.fontsDir')
  const stylesDir = settings.get<string>('defaults.stylesDir')
  const formats = settings.get<NonNullable<OutputConfig['fonts']>['formats']>('defaults.formats')
  const styleKind = settings.get<StyleOutputKind>('defaults.styleKind') ?? 'css'

  if (!fontsDir && !stylesDir) return defaultOutputConfig(font.project.preferences.font.family)

  return outputConfigFor({
    name: font.project.preferences.font.family,
    fontsDir,
    stylesDir,
    styleKind,
    formats,
  })
}

/** Builds one font and writes every configured output. */
export async function exportFont(font: IconFont, registry: IconFontRegistry): Promise<ExportResult> {
  const project = { ...font.project, output: resolveOutputConfig(font) }
  const selected = registry.selected(font)
  if (!selected.length) {
    return { font, written: [], glyphCount: 0, skipped: 'no icons are selected for export' }
  }

  const { resolveOutputs } = await heavy()
  const { files, build } = await resolveOutputs(project, { timestamp: 0 })
  const root = workspaceRoot(font)

  for (const file of files) {
    const target = vscode.Uri.joinPath(root, file.path)
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'))
    const data = typeof file.data === 'string' ? new TextEncoder().encode(file.data) : file.data
    // skip writing identical bytes: a no-op export should not dirty the working tree
    try {
      const existing = await vscode.workspace.fs.readFile(target)
      if (existing.length === data.length && existing.every((b, i) => b === data[i])) continue
    } catch {
      // not there yet
    }
    await vscode.workspace.fs.writeFile(target, data)
  }

  return { font, written: files, glyphCount: build.glyphs.length }
}

export function describeResult(result: ExportResult): string {
  if (result.skipped) return `${result.font.name}: ${result.skipped}`
  const byKind = new Map<string, number>()
  for (const file of result.written) byKind.set(file.kind, (byKind.get(file.kind) ?? 0) + 1)
  const parts = [...byKind.entries()].map(([kind, n]) => `${n} ${kind}`)
  return `${result.font.name}: ${result.glyphCount} glyph(s) → ${parts.join(', ')}`
}

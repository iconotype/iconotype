import { parseSync, type INode } from 'svgson'
/**
 * The parser/walker/generator subpaths, NOT the css-tree root.
 *
 * The root entry pulls in the CSS spec data (`../data/patch.json`), which it loads with
 * `createRequire(import.meta.url)` — that breaks in a bundled CJS extension, where the
 * path resolves next to the bundle rather than next to css-tree. We only ever parse and
 * re-generate declarations, never validate against the spec, so these are enough — and
 * they are a great deal smaller.
 */
import type * as csstree from 'css-tree'
import parse from 'css-tree/parser'
import walk from 'css-tree/walker'
import generate from 'css-tree/generator'
import type { FindingLog } from './findings.js'

/**
 * Stages 1–3 of docs/04: sanitize, resolve `<style>` into presentation attributes,
 * and dereference `<use>`/`<symbol>`. Everything downstream can then assume a plain
 * tree of shapes with their styling on the element.
 */

const DANGEROUS = new Set(['script', 'foreignObject', 'animate', 'animateTransform', 'animateMotion', 'set'])
const EDITOR_PREFIXES = ['inkscape:', 'sodipodi:', 'figma:', 'sketch:', 'illustrator:', 'serif:', 'krita:']

export interface PreparedDoc {
  root: INode
  /** id → element, for use/clip-path/mask lookups */
  byId: Map<string, INode>
}

const isElement = (n: INode): boolean => n.type === 'element'
const children = (n: INode): INode[] => (n.children ?? []).filter(isElement)

function indexIds(node: INode, byId: Map<string, INode>): void {
  const id = node.attributes?.id
  if (id && !byId.has(id)) byId.set(id, node)
  for (const child of children(node)) indexIds(child, byId)
}

/** Stage 1 — remove anything executable, animated or editor-specific. */
function sanitize(node: INode, log: FindingLog): INode {
  const attributes: Record<string, string> = {}
  for (const [k, v] of Object.entries(node.attributes ?? {})) {
    if (/^on/i.test(k)) { log.add('SCRIPT_STRIPPED', `event handler ${k} removed`); continue }
    if (EDITOR_PREFIXES.some((p) => k.startsWith(p))) continue
    if (k === 'href' || k === 'xlink:href') {
      if (v && !v.startsWith('#') && !v.startsWith('data:')) {
        log.add('EXTERNAL_REF', `external reference ${v} removed`)
        continue
      }
    }
    if (/javascript:/i.test(v)) { log.add('SCRIPT_STRIPPED', `javascript: URL removed`); continue }
    attributes[k] = v
  }

  const kept: INode[] = []
  for (const child of node.children ?? []) {
    if (child.type !== 'element') { kept.push(child); continue }
    if (DANGEROUS.has(child.name)) {
      if (child.name === 'script') log.add('SCRIPT_STRIPPED', '<script> removed')
      continue
    }
    kept.push(sanitize(child, log))
  }
  return { ...node, attributes, children: kept }
}

interface CssRule { selector: { tag?: string; cls?: string; id?: string }; specificity: number; decls: Record<string, string> }

/** Stage 2 — flatten `<style>` blocks and `style=""` into presentation attributes. */
function collectCss(node: INode, rules: CssRule[], log: FindingLog): void {
  for (const child of children(node)) {
    if (child.name === 'style') {
      const css = (child.children ?? []).map((c) => c.value ?? '').join('')
      try {
        const ast = parse(css)
        walk(ast, {
          visit: 'Rule',
          enter(rule: csstree.Rule) {
            const decls: Record<string, string> = {}
            walk(rule.block, {
              visit: 'Declaration',
              enter(d: csstree.Declaration) { decls[d.property] = generate(d.value).trim() },
            })
            const preludeText = generate(rule.prelude)
            for (const raw of preludeText.split(',')) {
              const sel = raw.trim()
              // supported: tag, .class, #id, tag.class — anything structural is skipped
              const m = /^([a-zA-Z][\w-]*)?(?:\.([\w-]+))?(?:#([\w-]+))?$/.exec(sel)
              if (!m || (!m[1] && !m[2] && !m[3])) {
                log.add('UNSUPPORTED_SELECTOR', `CSS selector "${sel}" ignored — only tag/.class/#id are resolved`)
                continue
              }
              rules.push({
                selector: { tag: m[1], cls: m[2], id: m[3] },
                specificity: (m[3] ? 100 : 0) + (m[2] ? 10 : 0) + (m[1] ? 1 : 0),
                decls,
              })
            }
          },
        })
        log.add('STYLE_INLINED', '<style> rules resolved into attributes')
      } catch (e) {
        log.add('UNSUPPORTED_SELECTOR', `could not parse <style>: ${(e as Error).message}`)
      }
    }
    collectCss(child, rules, log)
  }
}

const parseStyleAttr = (style: string | undefined): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const part of (style ?? '').split(';')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

function applyCss(node: INode, rules: CssRule[]): INode {
  const attrs = node.attributes ?? {}
  const classes = (attrs.class ?? '').split(/\s+/).filter(Boolean)
  const matched = rules
    .filter((r) =>
      (!r.selector.tag || r.selector.tag === node.name) &&
      (!r.selector.cls || classes.includes(r.selector.cls)) &&
      (!r.selector.id || r.selector.id === attrs.id))
    .sort((a, b) => a.specificity - b.specificity)

  // presentation attributes < CSS rules < inline style
  const merged: Record<string, string> = { ...attrs }
  for (const rule of matched) Object.assign(merged, rule.decls)
  Object.assign(merged, parseStyleAttr(attrs.style))
  delete merged.style

  return { ...node, attributes: merged, children: (node.children ?? []).map((c) => (c.type === 'element' ? applyCss(c, rules) : c)) }
}

/** Stage 3 — inline `<use>` targets so later stages never chase references. */
function deref(node: INode, byId: Map<string, INode>, log: FindingLog, depth = 0): INode {
  const out: INode[] = []
  for (const child of node.children ?? []) {
    if (child.type !== 'element') { out.push(child); continue }
    if (child.name === 'use') {
      const ref = (child.attributes?.href ?? child.attributes?.['xlink:href'] ?? '').replace(/^#/, '')
      const target = byId.get(ref)
      if (!target || depth > 8) {
        log.add('EXTERNAL_REF', `<use href="#${ref}"> could not be resolved`)
        continue
      }
      const { x = '0', y = '0', transform, ...restAttrs } = child.attributes ?? {}
      const shift = `translate(${x}, ${y})`
      // a <use> is equivalent to a <g> carrying the reference's content
      const clone = structuredClone(target)
      delete clone.attributes?.id
      out.push({
        ...child,
        name: 'g',
        attributes: { ...restAttrs, transform: [transform, shift].filter(Boolean).join(' ') },
        children: [clone.name === 'symbol' ? { ...clone, name: 'g' } : clone],
      })
      log.add('USE_RESOLVED', '<use> reference inlined')
      continue
    }
    out.push(deref(child, byId, log, depth + 1))
  }
  return { ...node, children: out }
}

export function prepare(source: string, log: FindingLog): PreparedDoc {
  if (!/<svg[\s/>]/i.test(source)) throw new Error('no <svg> element found — is this really an SVG file?')
  let root: INode
  try {
    root = parseSync(source)
  } catch (e) {
    throw new Error(`could not parse the SVG — ${(e as Error).message}`)
  }

  root = sanitize(root, log)

  const rules: CssRule[] = []
  collectCss(root, rules, log)
  root = applyCss(root, rules)

  const byId = new Map<string, INode>()
  indexIds(root, byId)
  root = deref(root, byId, log)

  // ids move around during deref; rebuild the index for clip/mask lookups
  const finalIds = new Map<string, INode>()
  indexIds(root, finalIds)
  return { root, byId: finalIds }
}

export { isElement, children }

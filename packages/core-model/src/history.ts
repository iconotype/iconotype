import { apply, labelOf, type Op } from './ops.js'
import type { Project } from './types.js'

/**
 * History is a TREE, not a stack.
 *
 * Undo moves the pointer to the parent. Redoing after you have diverged creates a
 * SIBLING branch instead of destroying the future — which is what gives us IcoMoon's
 * "Branches" panel for free, and means no work is ever lost by undo-then-edit.
 */
export interface HistoryNode {
  id: string
  parent: string | null
  children: string[]
  /** null on the root node */
  op: Op | null
  inverse: Op | null
  label: string
  /** caller-supplied clock; never Date.now() inside core (determinism) */
  at: number
}

export interface History {
  nodes: Record<string, HistoryNode>
  rootId: string
  currentId: string
  /** insertion counter → stable ids without randomness */
  seq: number
}

export const ROOT_LABEL = 'New project'

export function createHistory(label = ROOT_LABEL, at = 0): History {
  const rootId = 'h0'
  return {
    rootId,
    currentId: rootId,
    seq: 1,
    nodes: { [rootId]: { id: rootId, parent: null, children: [], op: null, inverse: null, label, at } },
  }
}

export interface Session {
  project: Project
  history: History
}

/** Applies an op and records it as a child of the current node. */
export function commit(session: Session, op: Op, at = 0, label?: string): Session {
  const { next, inverse } = apply(session.project, op)
  const id = `h${session.history.seq}`
  const node: HistoryNode = {
    id,
    parent: session.history.currentId,
    children: [],
    op,
    inverse,
    label: label ?? labelOf(op),
    at,
  }
  const nodes = { ...session.history.nodes }
  nodes[id] = node
  const parent = nodes[session.history.currentId]!
  // newest branch first — the UI reads children[0] as "the" redo
  nodes[parent.id] = { ...parent, children: [id, ...parent.children] }
  return {
    project: next,
    history: { ...session.history, nodes, currentId: id, seq: session.history.seq + 1 },
  }
}

export const canUndo = (s: Session): boolean => s.history.nodes[s.history.currentId]!.parent !== null
export const canRedo = (s: Session): boolean => s.history.nodes[s.history.currentId]!.children.length > 0

export function undo(session: Session): Session {
  const node = session.history.nodes[session.history.currentId]!
  if (!node.parent || !node.inverse) return session
  const { next } = apply(session.project, node.inverse)
  return { project: next, history: { ...session.history, currentId: node.parent } }
}

/** Redo into a specific branch; defaults to the most recent one. */
export function redo(session: Session, branchId?: string): Session {
  const node = session.history.nodes[session.history.currentId]!
  const childId = branchId ?? node.children[0]
  if (!childId) return session
  const child = session.history.nodes[childId]
  if (!child || child.parent !== node.id) throw new Error(`redo: ${childId} is not a child of ${node.id}`)
  const { next } = apply(session.project, child.op!)
  return { project: next, history: { ...session.history, currentId: childId } }
}

const pathToRoot = (h: History, id: string): string[] => {
  const out: string[] = []
  let cur: string | null = id
  while (cur) { out.push(cur); cur = h.nodes[cur]!.parent }
  return out
}

/**
 * Jump to any node in the tree — the History panel's click handler.
 * Walks up to the common ancestor applying inverses, then down applying ops.
 */
export function goto(session: Session, targetId: string): Session {
  if (targetId === session.history.currentId) return session
  const h = session.history
  if (!h.nodes[targetId]) throw new Error(`goto: unknown node ${targetId}`)
  const fromPath = pathToRoot(h, h.currentId)
  const toPath = pathToRoot(h, targetId)
  const common = fromPath.find((id) => toPath.includes(id))!
  let project = session.project
  for (const id of fromPath) {
    if (id === common) break
    project = apply(project, h.nodes[id]!.inverse!).next
  }
  const down = toPath.slice(0, toPath.indexOf(common)).reverse()
  for (const id of down) project = apply(project, h.nodes[id]!.op!).next
  return { project, history: { ...h, currentId: targetId } }
}

/** The linear list the History panel renders: root → current, plus any sibling branches. */
export function timeline(h: History): Array<HistoryNode & { current: boolean; branchCount: number }> {
  return pathToRoot(h, h.currentId)
    .reverse()
    .map((id) => {
      const n = h.nodes[id]!
      return { ...n, current: id === h.currentId, branchCount: Math.max(0, n.children.length - (id === h.currentId ? 0 : 1)) }
    })
}

/** Branch points reachable from the current path — feeds the "Branches" tab. */
export function branches(h: History): Array<{ from: HistoryNode; alternatives: HistoryNode[] }> {
  const onPath = new Set(pathToRoot(h, h.currentId))
  const out: Array<{ from: HistoryNode; alternatives: HistoryNode[] }> = []
  for (const id of onPath) {
    const n = h.nodes[id]!
    const alts = n.children.filter((c) => !onPath.has(c)).map((c) => h.nodes[c]!)
    if (alts.length) out.push({ from: n, alternatives: alts })
  }
  return out
}

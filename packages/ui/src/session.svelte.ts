import { getContext, setContext } from 'svelte'
import type { Host } from '@iconotype/core-host'
import {
  branches, canRedo, canUndo, commit, createHistory, emptyProject, goto, redo, timeline, undo,
  type Op, type Project, type Session,
} from '@iconotype/core-model'

const HOST = Symbol('iconotype.host')

export const setHost = (host: Host) => setContext(HOST, host)
export const useHost = (): Host => {
  const h = getContext<Host>(HOST)
  if (!h) throw new Error('no Host in context — the app shell must call setHost()')
  return h
}

/**
 * Reactive wrapper over the pure core Session. All mutation goes through do(),
 * so the History panel and undo/redo work without any component knowing about them.
 */
export class SessionStore {
  /**
   * $state.raw, NOT $state.
   *
   * Deep $state wraps the document in a Proxy, and structuredClone() — which every
   * core op uses to stay immutable — throws DataCloneError on a proxy. Raw state is
   * also the honest model here: commit() returns a whole new session object, so
   * reactivity should key on the reference, not on nested mutation.
   */
  #session = $state.raw<Session>({ project: emptyProject('p0'), history: createHistory() })
  /** monotonic clock supplied by the shell — core never calls Date.now() */
  #now: () => number

  constructor(session?: Session, now: () => number = () => 0) {
    if (session) this.#session = session
    this.#now = now
  }

  get project(): Project { return this.#session.project }
  get history() { return this.#session.history }
  get timeline() { return timeline(this.#session.history) }
  get branches() { return branches(this.#session.history) }
  get canUndo() { return canUndo(this.#session) }
  get canRedo() { return canRedo(this.#session) }
  get glyphCount() { return this.#session.project.sets.reduce((n, s) => n + s.glyphs.length, 0) }

  do(op: Op, label?: string) { this.#session = commit(this.#session, op, this.#now(), label) }

  /** Swap the whole document, still as a single undoable step. */
  replace(project: Project, label = 'Import project') { this.do({ t: 'project.replace', project }, label) }

  /**
   * Open a document: a new timeline, not a step in the old one.
   *
   * Replacing kept the previous project as undo's parent, so the first ⌘Z on a
   * freshly opened file emptied it — which reads exactly like "undo deleted my
   * icons" when the thing being undone is the open itself. A document's history
   * starts when the document does.
   */
  open(project: Project, label = 'Open project') {
    this.#session = { project, history: createHistory(label, this.#now()) }
  }
  undo() { this.#session = undo(this.#session) }
  redo(branchId?: string) { this.#session = redo(this.#session, branchId) }
  goto(nodeId: string) { this.#session = goto(this.#session, nodeId) }
}

const SESSION = Symbol('iconotype.session')
export const setSession = (s: SessionStore) => setContext(SESSION, s)
export const useSession = (): SessionStore => {
  const s = getContext<SessionStore>(SESSION)
  if (!s) throw new Error('no SessionStore in context')
  return s
}

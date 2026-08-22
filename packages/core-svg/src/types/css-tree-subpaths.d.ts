/**
 * @types/css-tree only declares the package root. We import the parser, walker and
 * generator subpaths to avoid the spec data (see prepare.ts), so declare those.
 */
declare module 'css-tree/parser' {
  import type { CssNode, ParseOptions } from 'css-tree'
  const parse: (source: string, options?: ParseOptions) => CssNode
  export default parse
}
declare module 'css-tree/walker' {
  import type { CssNode } from 'css-tree'
  const walk: (ast: CssNode, options: unknown) => void
  export default walk
}
declare module 'css-tree/generator' {
  import type { CssNode } from 'css-tree'
  const generate: (node: CssNode, options?: unknown) => string
  export default generate
}

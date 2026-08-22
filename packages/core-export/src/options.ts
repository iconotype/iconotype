/** The formatting switches IcoMoon exposes on every text export. */
export interface FormatOptions {
  /** emit `<title>` inside each SVG, for accessibility */
  addTitle?: boolean
  /** prefix element ids with the glyph name so two sprites can coexist on a page */
  prependNamesToIds?: boolean
  /** write width/height attributes as well as a viewBox */
  fixedSize?: boolean
  /** px value used when fixedSize is on */
  size?: number
  removeNewlines?: boolean
  useTabs?: boolean
  indentSize?: number
  /** css class prefix, e.g. `icon-` */
  prefix?: string
  postfix?: string
}

export const DEFAULT_FORMAT: Required<FormatOptions> = {
  addTitle: false,
  prependNamesToIds: true,
  fixedSize: false,
  size: 24,
  removeNewlines: false,
  useTabs: false,
  indentSize: 2,
  prefix: 'icon-',
  postfix: '',
}

export const resolveFormat = (opts: FormatOptions = {}): Required<FormatOptions> => ({ ...DEFAULT_FORMAT, ...opts })

export const indent = (level: number, opts: Required<FormatOptions>): string =>
  opts.useTabs ? '\t'.repeat(level) : ' '.repeat(level * opts.indentSize)

/** Applies the whitespace switches to a finished document. */
export function finish(text: string, opts: Required<FormatOptions>): string {
  return opts.removeNewlines ? text.replace(/\n\s*/g, '') : text
}

export const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** `icon-home` → `IconHome`, for component names. */
export const pascalCase = (name: string): string =>
  name.replace(/(^|[^a-zA-Z0-9])([a-zA-Z0-9])/g, (_, __, c: string) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '')

/** A name that is safe as a JS identifier. */
export const identifier = (name: string): string => {
  const camel = name.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c: string) => (c ? c.toUpperCase() : ''))
  return /^[0-9]/.test(camel) ? `icon${camel[0]!.toUpperCase()}${camel.slice(1)}` : camel
}

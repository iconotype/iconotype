/**
 * A syntax highlighter the size of a scroll bar.
 *
 * Shiki and Prism both do this better, and both cost more than the whole app: the
 * snippets are a few dozen lines of well-formed code in seven languages, read once.
 * What a reader actually needs is comments receding, strings and keywords separating,
 * and nothing lying to them — so this tokenises with one ordered regex per family and
 * gives up gracefully, leaving plain text, rather than guessing.
 *
 * Tokens come back as data, never as markup: the caller renders `<span>`s, so nothing
 * here can inject HTML into a page that also displays a project's own file paths.
 */

export type TokenKind = 'comment' | 'string' | 'keyword' | 'number' | 'tag' | 'attr' | 'property' | 'plain'
export interface Token { text: string; kind: TokenKind }

type Rule = { kind: TokenKind; re: RegExp }
type Family = 'markup' | 'style' | 'script' | 'data' | 'plain'

/** Which grammar a snippet's `lang` is closest to. */
const FAMILY: Record<string, Family> = {
  html: 'markup', xml: 'markup',
  css: 'style', scss: 'style',
  js: 'script', ts: 'script', tsx: 'script', dart: 'script',
  yaml: 'data', json: 'data',
}

const KEYWORDS =
  /\b(?:import|from|export|default|const|let|var|function|return|if|else|for|of|in|new|class|extends|static|await|async|type|interface|enum|as|require|module|true|false|null|undefined|this|void)\b/

/**
 * Ordered: the first rule that matches at a position wins, so comments must precede
 * strings (a `//` inside a comment is not a url) and strings must precede everything
 * that could appear inside one.
 */
const RULES: Record<Family, Rule[]> = {
  markup: [
    { kind: 'comment', re: /<!--[\s\S]*?-->/ },
    { kind: 'string', re: /"[^"\n]*"|'[^'\n]*'/ },
    { kind: 'tag', re: /<\/?[A-Za-z][\w:-]*|\/?>/ },
    { kind: 'attr', re: /[A-Za-z_:][\w:.-]*(?=\s*=)/ },
    { kind: 'keyword', re: /\{[^{}\n]*\}/ },
  ],
  style: [
    { kind: 'comment', re: /\/\*[\s\S]*?\*\/|\/\/[^\n]*/ },
    { kind: 'string', re: /"[^"\n]*"|'[^'\n]*'/ },
    { kind: 'keyword', re: /@[\w-]+|[$@][\w-]+/ },
    { kind: 'property', re: /[-a-zA-Z]+(?=\s*:)/ },
    { kind: 'number', re: /-?\b\d[\w.%]*/ },
    { kind: 'tag', re: /\.[-\w]+|#[-\w]+|::?[-\w]+/ },
  ],
  script: [
    { kind: 'comment', re: /\/\*[\s\S]*?\*\/|\/\/[^\n]*/ },
    { kind: 'string', re: /`(?:\\[\s\S]|[^`\\])*`|"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*'/ },
    { kind: 'keyword', re: /\/(?![/*])(?:\\.|\[[^\]\n]*\]|[^/\\\n])+\/[gimsuy]*/ },  // a regex literal
    { kind: 'keyword', re: KEYWORDS },
    { kind: 'number', re: /\b0x[\da-fA-F]+\b|\b\d+(?:\.\d+)?\b/ },
    { kind: 'attr', re: /\b[A-Za-z_$][\w$]*(?=\s*\()/ },
    { kind: 'property', re: /\b[A-Za-z_$][\w$]*(?=\s*:)/ },
  ],
  data: [
    { kind: 'comment', re: /#[^\n]*/ },
    { kind: 'string', re: /"[^"\n]*"|'[^'\n]*'/ },
    { kind: 'property', re: /^[ \t-]*[\w.-]+(?=\s*:)/m },
    { kind: 'number', re: /-?\b\d[\d.]*\b/ },
  ],
  plain: [],
}

/**
 * Splits code into tokens.
 *
 * Linear scan: at each position, try every rule anchored there and take the first that
 * matches, otherwise consume one character as plain text. Runs of plain text are
 * merged so a 40-line snippet renders as a handful of spans rather than thousands.
 */
export function highlight(code: string, lang: string): Token[] {
  const rules = RULES[FAMILY[lang] ?? 'plain']
  if (!rules.length) return code ? [{ text: code, kind: 'plain' }] : []

  // anchored copies, built once per call — a sticky regex remembers lastIndex per use
  const anchored = rules.map((rule) => ({
    kind: rule.kind,
    re: new RegExp(rule.re.source, rule.re.flags.replace(/[gy]/g, '') + 'y'),
  }))

  const tokens: Token[] = []
  let plain = ''
  const flush = () => { if (plain) { tokens.push({ text: plain, kind: 'plain' }); plain = '' } }

  let i = 0
  while (i < code.length) {
    let matched = false
    for (const rule of anchored) {
      rule.re.lastIndex = i
      const m = rule.re.exec(code)
      if (!m || !m[0]) continue
      flush()
      tokens.push({ text: m[0], kind: rule.kind })
      i += m[0].length
      matched = true
      break
    }
    if (!matched) { plain += code[i]; i += 1 }
  }
  flush()
  return tokens
}

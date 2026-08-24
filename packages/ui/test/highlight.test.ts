import { describe, expect, it } from 'vitest'
import { highlight, type Token } from '../src/lib/highlight.js'

/** the highlighter must never lose or invent a character */
const roundTrip = (code: string, lang: string) => highlight(code, lang).map((t) => t.text).join('')
const kindsOf = (tokens: Token[], text: string) => tokens.filter((t) => t.text === text).map((t) => t.kind)

describe('highlight', () => {
  it('reproduces the input exactly, whatever the language', () => {
    const samples: Array<[string, string]> = [
      ['<link rel="stylesheet" href="style.css">', 'html'],
      ['.icon-home:before { content: "\\e900"; }', 'css'],
      ["import icons from './icons.json'   // the map", 'ts'],
      ['flutter:\n  fonts:\n    - family: alpimaps', 'yaml'],
      ['Icon(Alpimaps.hiking, size: 24)', 'dart'],
      ['plain text, no grammar', 'plain'],
      ['', 'ts'],
    ]
    for (const [code, lang] of samples) expect(roundTrip(code, lang), lang).toBe(code)
  })

  it('separates comments, strings and keywords in script', () => {
    const tokens = highlight("// note\nconst x = 'hi'", 'ts')
    expect(kindsOf(tokens, '// note')).toEqual(['comment'])
    expect(kindsOf(tokens, "'hi'")).toEqual(['string'])
    expect(kindsOf(tokens, 'const')).toEqual(['keyword'])
  })

  it('does not read a comment as code, or a url as a comment', () => {
    const tokens = highlight("const u = 'https://x.dev' // real comment", 'ts')
    expect(tokens.find((t) => t.text.includes('https'))!.kind).toBe('string')
    expect(kindsOf(tokens, '// real comment')).toEqual(['comment'])
  })

  it('marks tags and attributes in markup, and leaves text alone', () => {
    const tokens = highlight('<i class="icon-home" aria-hidden="true"></i>', 'html')
    expect(kindsOf(tokens, '<i')).toEqual(['tag'])
    expect(kindsOf(tokens, 'class')).toEqual(['attr'])
    expect(kindsOf(tokens, '"icon-home"')).toEqual(['string'])
  })

  it('marks properties and at-rules in stylesheets', () => {
    const tokens = highlight('@font-face { font-family: "alpimaps"; }', 'css')
    expect(kindsOf(tokens, '@font-face')).toEqual(['keyword'])
    expect(kindsOf(tokens, 'font-family')).toEqual(['property'])
  })

  it('merges runs of plain text rather than emitting a span per character', () => {
    const tokens = highlight('a b c d e f g', 'ts')
    expect(tokens.length).toBeLessThan(5)
  })

  it('leaves an unknown language entirely plain', () => {
    expect(highlight('anything at all', 'cobol')).toEqual([{ text: 'anything at all', kind: 'plain' }])
  })
})

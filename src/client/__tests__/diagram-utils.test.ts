import { describe, expect, it } from 'vitest'
import { mermaidErrorText, neutralizeNoteListMarkers } from '../editor/views/diagram-utils.ts'

const WJ = '⁠'

describe('diagram utils', () => {
  it('REQ-EDITOR-007 note 块内的列表标记插 U+2060，块外不动', () => {
    const src = [
      'stateDiagram-v2',
      '    1. this line is NOT in a note',
      '    note right of A',
      '        1. activate policy',
      '        2) deactivate policy',
      '        - bullet item',
      '    end note',
      '    A --> B : 3. after the note',
    ].join('\n')
    const lines = neutralizeNoteListMarkers(src).split('\n')
    expect(lines[1]).toBe('    1. this line is NOT in a note')
    expect(lines[3]).toBe(`        1${WJ}. activate policy`)
    expect(lines[4]).toBe(`        2${WJ}) deactivate policy`)
    expect(lines[5]).toBe(`        -${WJ} bullet item`)
    expect(lines[7]).toBe('    A --> B : 3. after the note')
    expect(neutralizeNoteListMarkers('graph TD\nA-->B')).toBe('graph TD\nA-->B')
  })

  it('REQ-EDITOR-007 解析错误压成至多 4 行文字', () => {
    expect(
      mermaidErrorText(new Error('Parse error on line 2:\nA-->\n---^\nExpecting X\nmore')),
    ).toBe('Parse error on line 2:\nA-->\n---^\nExpecting X')
  })
})

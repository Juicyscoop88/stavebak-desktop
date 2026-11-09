import { describe, it, expect } from 'vitest'
import { isProjectFile, overallPercent, progressText, stepFraction } from './guide-progress'

describe('karta projektu pozná změnu stavebak.json (#71)', () => {
  it('Windows: zpětná lomítka v cestě z hlídače souborů', () => {
    expect(isProjectFile('C:\\Users\\projektant\\Documents\\Stavebák\\KH\\stavebak.json', 'C:\\Users\\projektant\\Documents\\Stavebák\\KH')).toBe(true)
  })
  it('Windows: smíšená lomítka, předpona \\\\?\\ a velikost písmene disku', () => {
    expect(isProjectFile('C:\\p\\KH\\stavebak.json', 'C:/p/KH')).toBe(true)
    expect(isProjectFile('\\\\?\\C:\\p\\KH\\stavebak.json', 'C:\\p\\KH')).toBe(true)
    expect(isProjectFile('c:\\p\\KH\\stavebak.json', 'C:\\p\\KH\\')).toBe(true)
  })
  it('macOS a Linux', () => {
    expect(isProjectFile('/Users/a/KH/stavebak.json', '/Users/a/KH')).toBe(true)
  })
  it('soubor stejného jména v podsložce ani jiný soubor kartu neobnoví', () => {
    expect(isProjectFile('C:\\p\\KH\\podklady\\stavebak.json', 'C:\\p\\KH')).toBe(false)
    expect(isProjectFile('C:\\p\\KH\\stavebak.json.tmp', 'C:\\p\\KH')).toBe(false)
    expect(isProjectFile('/p/KH/zprava.md', '/p/KH')).toBe(false)
  })
})

describe('postup se hýbe i u rozpracovaných kroků (#69)', () => {
  it('rozpracovaný krok se počítá podílem, hotový celý', () => {
    expect(stepFraction({ status: 'available', completion: { known: 9, total: 10 } })).toBe(0.9)
    expect(stepFraction({ status: 'done', completion: { known: 0, total: 0 } })).toBe(1)
    expect(stepFraction({ status: 'waiting', completion: { known: 0, total: 0 } })).toBe(0)
  })
  it('text uvádí hotové, rozpracované a procenta', () => {
    expect(progressText({ progress: { done: 2, total: 15, started: 3, percent: 24 } })).toBe('2 z 15 kroků · 3 rozpracované · 24 %')
    expect(progressText({ progress: { done: 2, total: 15, started: 1, percent: 24 } })).toBe('2 z 15 kroků · 1 rozpracovaný · 24 %')
  })
  it('starší server bez procent: počítá se z hotových kroků', () => {
    expect(overallPercent({ progress: { done: 3, total: 15 } })).toBe(20)
    expect(progressText({ progress: { done: 3, total: 15 } })).toBe('3 z 15 kroků')
    expect(stepFraction({ status: 'available' })).toBe(0)
  })
})

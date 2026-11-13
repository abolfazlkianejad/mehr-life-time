import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const en = JSON.parse(readFileSync(join(root, 'src/i18n/locales/en.json'), 'utf8'))
const fa = JSON.parse(readFileSync(join(root, 'src/i18n/locales/fa.json'), 'utf8'))

function flatten(obj, prefix = '', out = new Set()) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, path, out)
    else out.add(path)
  }
  return out
}

const enKeys = flatten(en)
const faKeys = flatten(fa)

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) yield* walk(full)
    else if (/\.(ts|tsx)$/.test(entry)) yield full
  }
}

const used = new Set()
const dynamic = new Set()
for (const file of walk(join(root, 'src'))) {
  const text = readFileSync(file, 'utf8')
  // every string literal that sits inside a t(...) call, including ternaries
  for (const call of text.matchAll(/\bt\(([^\n]{0,400})/g)) {
    for (const literal of call[1].matchAll(/(['"`])([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)\1/g)) used.add(literal[2])
  }
  for (const match of text.matchAll(/\bt\(\s*`([^`]*)\$\{/g)) dynamic.add(match[1])
}

const missingEn = [...used].filter((key) => !enKeys.has(key)).sort()
const missingFa = [...used].filter((key) => !faKeys.has(key)).sort()
const enOnly = [...enKeys].filter((key) => !faKeys.has(key)).sort()
const faOnly = [...faKeys].filter((key) => !enKeys.has(key)).sort()

console.log('USED LITERAL KEYS:', used.size)
console.log('MISSING IN EN:', missingEn.length)
for (const key of missingEn) console.log('  en:', key)
console.log('MISSING IN FA:', missingFa.length)
for (const key of missingFa) console.log('  fa:', key)
console.log('EN ONLY (not in fa):', enOnly.length)
for (const key of enOnly) console.log('  ', key)
console.log('FA ONLY (not in en):', faOnly.length)
for (const key of faOnly) console.log('  ', key)
console.log('DYNAMIC PREFIXES:')
for (const prefix of [...dynamic].sort()) console.log('  ', prefix)

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = join(root, 'node_modules', 'web-sqlite-js')
const upstreamPath = join(packageRoot, 'dist', 'index.js')
const declarationPath = join(packageRoot, 'dist', 'index.d.ts')
const vendorRoot = join(root, 'src', 'vendor', 'web-sqlite')
const expectedSha256 = '97ab499174918ff700f17213c9493ad325af6c0cc7bf29c6eb1eae04789c4784'
const opfsUrl = 'new URL("./web-sqlite-opfs-proxy.js",self.location.href).href'
const mainWorkerFactory =
  'function n(n){return new Worker(new URL("./web-sqlite-worker.js",import.meta.url),{name:n?.name})}'

interface StringLiteral {
  end: number
  value: string
}

function readJsStringLiteral(source: string, start: number): StringLiteral {
  const quote = source[start]
  if (quote !== "'" && quote !== '"') throw new Error('Expected a JavaScript string literal.')

  let escaped = false
  for (let index = start + 1; index < source.length; index += 1) {
    if (escaped) {
      escaped = false
      continue
    }
    if (source[index] === '\\') {
      escaped = true
      continue
    }
    if (source[index] === quote) {
      const literal = source.slice(start, index + 1)
      const value = runInNewContext(`(${literal})`, Object.create(null), {
        timeout: 1_000,
      }) as unknown
      if (typeof value !== 'string') throw new Error('Decoded worker literal was not a string.')
      return { end: index + 1, value }
    }
  }

  throw new Error('Unterminated JavaScript string literal.')
}

function replaceExactly(
  source: string,
  target: string,
  replacement: string,
  label: string
): string {
  const parts = source.split(target)
  const count = parts.length - 1
  if (count !== 1) throw new Error(`${label} replacement count was ${count}; expected 1.`)
  return parts.join(replacement)
}

function assertWorkerSafety(source: string, label: string): void {
  if (/createObjectURL\s*\(\s*new Blob/.test(source)) {
    throw new Error(`${label} still creates an inline Blob worker.`)
  }
  if (/data:text\/javascript/.test(source)) {
    throw new Error(`${label} still contains a data URL worker.`)
  }
  if (/(?:importScripts|new\s+Worker)\s*\(\s*(?:new URL\(\s*)?['"]https?:\/\//.test(source)) {
    throw new Error(`${label} still loads remote executable worker code.`)
  }
}

const upstream = readFileSync(upstreamPath, 'utf8')
const actualSha256 = createHash('sha256').update(upstream).digest('hex')
if (actualSha256 !== expectedSha256) {
  throw new Error(`web-sqlite-js dist/index.js SHA-256 mismatch: ${actualSha256}`)
}

const leadingLiteralPrefix = 'const e='
if (!upstream.startsWith(leadingLiteralPrefix)) {
  throw new Error('Pinned bundle is missing the leading Vite worker literal.')
}
const leadingLiteralStart = leadingLiteralPrefix.length
const leadingWorker = readJsStringLiteral(upstream, leadingLiteralStart)

const opfsBlobPrefix = 'URL.createObjectURL(new Blob(['
const opfsBlobStart = leadingWorker.value.indexOf(opfsBlobPrefix)
if (opfsBlobStart < 0) throw new Error('Pinned bundle is missing the inline OPFS proxy worker.')
const opfsLiteralStart = opfsBlobStart + opfsBlobPrefix.length
const opfsWorker = readJsStringLiteral(leadingWorker.value, opfsLiteralStart)
const opfsBlobSuffix = '],{type:"application/javascript"}))'
const opfsBlobEnd = opfsWorker.end + opfsBlobSuffix.length
if (leadingWorker.value.slice(opfsWorker.end, opfsBlobEnd) !== opfsBlobSuffix) {
  throw new Error('Pinned OPFS proxy worker format changed.')
}

const originalOpfsFactory = leadingWorker.value.slice(opfsBlobStart, opfsBlobEnd)
const sqliteWorker = replaceExactly(
  leadingWorker.value,
  originalOpfsFactory,
  opfsUrl,
  'OPFS worker URL'
)

const mainWorkerStart = upstream.indexOf('function n(n){', leadingWorker.end)
const mainWorkerEnd = upstream.indexOf('var r=', mainWorkerStart)
if (mainWorkerStart < 0 || mainWorkerEnd < 0) {
  throw new Error('Pinned bundle is missing the Vite main worker factory.')
}
const originalMainWorkerFactory = upstream.slice(mainWorkerStart, mainWorkerEnd)
const mainWithLocalFactory = replaceExactly(
  upstream,
  originalMainWorkerFactory,
  mainWorkerFactory,
  'SQLite worker factory'
)
const main = `${mainWithLocalFactory.slice(0, leadingLiteralStart)}""${mainWithLocalFactory.slice(leadingWorker.end)}`

for (const [source, label] of [
  [main, 'Main bundle'],
  [sqliteWorker, 'SQLite worker'],
  [opfsWorker.value, 'OPFS proxy worker'],
] as const) {
  assertWorkerSafety(source, label)
}
if (!main.includes('web-sqlite-worker.js')) {
  throw new Error('Main bundle does not reference the packaged SQLite worker.')
}
if (!sqliteWorker.includes('web-sqlite-opfs-proxy.js')) {
  throw new Error('SQLite worker does not reference the packaged OPFS proxy.')
}

mkdirSync(vendorRoot, { recursive: true })
writeFileSync(join(vendorRoot, 'index.js'), main)
writeFileSync(join(vendorRoot, 'index.d.ts'), readFileSync(declarationPath, 'utf8'))
writeFileSync(join(vendorRoot, 'web-sqlite-worker.js'), sqliteWorker)
writeFileSync(join(vendorRoot, 'web-sqlite-opfs-proxy.js'), opfsWorker.value)

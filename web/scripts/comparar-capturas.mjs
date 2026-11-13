// Compara duas pastas de capturas (antes e depois) pixel a pixel e lista o que mudou.
//   node scripts/comparar-capturas.mjs <pasta-antes> <pasta-depois> [pasta-das-diferenças]
// Numa refatoração sem mudança visual o esperado é 0 em todas; numa mudança visual, a lista é o que revisar.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

const [antes, depois, saida] = process.argv.slice(2)
if (!antes || !depois) {
  console.error('uso: node scripts/comparar-capturas.mjs <antes> <depois> [diferenças]')
  process.exit(2)
}
if (saida) mkdirSync(saida, { recursive: true })

let mudaram = 0
for (const nome of readdirSync(antes)
  .filter((f) => f.endsWith('.png'))
  .sort()) {
  if (!existsSync(join(depois, nome))) {
    console.log(`? ${nome} — não existe na segunda pasta`)
    continue
  }
  const a = PNG.sync.read(readFileSync(join(antes, nome)))
  const b = PNG.sync.read(readFileSync(join(depois, nome)))
  if (a.width !== b.width || a.height !== b.height) {
    console.log(`✗ ${nome} — tamanho mudou (${a.width}×${a.height} → ${b.width}×${b.height})`)
    mudaram++
    continue
  }
  const diff = new PNG({ width: a.width, height: a.height })
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 })
  const pct = (n / (a.width * a.height)) * 100
  if (n > 0) {
    mudaram++
    if (saida) writeFileSync(join(saida, nome), PNG.sync.write(diff))
  }
  console.log(`${n ? '✗' : '✓'} ${nome} — ${n} pixel(s), ${pct.toFixed(2)}%`)
}
console.log(mudaram ? `\n${mudaram} captura(s) com diferença` : '\nSem diferença')
process.exit(mudaram ? 1 : 0)

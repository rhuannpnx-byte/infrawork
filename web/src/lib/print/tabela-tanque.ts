// Folha de controle do tanque para imprimir: UMA página A4 em pé, para ficar colada ao lado do tanque. Traz o
// cabeçalho, o ábaco (curva régua × litros) e a tabela centímetro a centímetro. O número de colunas e o tamanho da
// letra são calculados para a tabela inteira caber na página; tanque muito alto sai de 2 em 2 cm (ou de 5 em 5),
// com o aviso no rodapé. As cores são fixas de impressão, como nos outros documentos desta pasta.

export interface LinhaFolhaTanque {
  /** o número que o operador lê na régua */
  leitura: number
  litros: number
  /** litros entre esta altura e 1 cm abaixo (quanto vale aquele centímetro) */
  litrosPorCm: number
}

export interface FolhaTanque {
  obra: string
  tanque: string
  material: string
  formato: string
  /** medidas em texto, já prontas ("Ø 250 cm × 600 cm, tampos abaulados de 30 cm") */
  medidas: string
  capacidadeLitros: number
  /** 'cheio' = a régua mede o líquido; 'vazio' = mede da boca de medição até o líquido */
  leituraPor: 'cheio' | 'vazio'
  alturaReferenciaCm: number | null
  /** em ordem crescente da leitura, de 1 em 1 cm */
  linhas: LinhaFolhaTanque[]
}

const C = {
  tinta: '#111827',
  apoio: '#4b5563',
  linha: '#d1d5db',
  linhaForte: '#6b7280',
  faixa: '#f3f4f6',
  curva: '#1d4ed8'
}

// Medidas da página, em mm (A4 com 10 mm de margem)
const LARGURA_UTIL = 190
const ALTURA_UTIL = 277
/** o que o cabeçalho, o ábaco, o rodapé e os respiros ocupam; o resto é da tabela */
const ALTURA_FORA_DA_TABELA = 95
const ALTURA_TABELA = ALTURA_UTIL - ALTURA_FORA_DA_TABELA
const ESPACO_ENTRE_COLUNAS = 2.5
/** linha confortável de ler, e a menor que ainda se lê no papel */
const LINHA_BOA = 2.6
const LINHA_MINIMA = 1.95
const COLUNAS_MIN = 4
const COLUNAS_MAX = 7

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const num = (v: number, casas = 0): string =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
const cm = (v: number): string => num(v, Number.isInteger(v) ? 0 : 1)

/** Passo "redondo" para dividir um eixo em cerca de `partes` marcas. */
function passoRedondo(maximo: number, partes: number): number {
  const bruto = maximo / partes
  const pot = 10 ** Math.floor(Math.log10(bruto))
  const f = bruto / pot
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pot
}

export interface ArranjoFolha {
  /** de quantos em quantos centímetros a tabela sai (1, 2 ou 5) */
  passoCm: number
  colunas: number
  linhasPorColuna: number
  /** altura de cada linha da tabela, em mm */
  alturaLinha: number
}

/**
 * Como a tabela cabe numa página: o menor número de colunas que dá uma linha boa de ler; se nem com o máximo de
 * colunas der uma linha legível, a tabela sai de 2 em 2 cm, e depois de 5 em 5.
 */
export function arranjoDaFolha(totalDeLinhas: number): ArranjoFolha {
  for (const passoCm of [1, 2, 5]) {
    const n = Math.ceil(totalDeLinhas / passoCm) + (passoCm > 1 ? 1 : 0)
    let escolhido: ArranjoFolha | null = null
    for (let colunas = COLUNAS_MIN; colunas <= COLUNAS_MAX; colunas++) {
      const linhasPorColuna = Math.ceil(n / colunas)
      // + 1: a linha de títulos de cada coluna
      const alturaLinha = ALTURA_TABELA / (linhasPorColuna + 1)
      const arranjo = { passoCm, colunas, linhasPorColuna, alturaLinha: Math.min(alturaLinha, 3.4) }
      if (alturaLinha >= LINHA_BOA) return arranjo
      if (alturaLinha >= LINHA_MINIMA) escolhido = arranjo
    }
    if (escolhido) return escolhido
  }
  // tanque fora de qualquer medida razoável: de 5 em 5 cm, no máximo de colunas
  const n = Math.ceil(totalDeLinhas / 5) + 1
  const linhasPorColuna = Math.ceil(n / COLUNAS_MAX)
  return {
    passoCm: 5,
    colunas: COLUNAS_MAX,
    linhasPorColuna,
    alturaLinha: ALTURA_TABELA / (linhasPorColuna + 1)
  }
}

/** As linhas que entram na tabela: de `passo` em `passo`, sempre com a primeira e a última. */
function linhasDoPasso(linhas: LinhaFolhaTanque[], passo: number): LinhaFolhaTanque[] {
  if (passo <= 1) return linhas
  const ultima = linhas.length - 1
  return linhas.filter((_, i) => i % passo === 0 || i === ultima)
}

function abaco(f: FolhaTanque): string {
  const W = 700
  const H = 168
  const m = { e: 62, d: 14, t: 8, b: 30 }
  const lw = W - m.e - m.d
  const lh = H - m.t - m.b
  const xs = f.linhas.map((l) => l.leitura)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMax = Math.max(f.capacidadeLitros, 1)
  const px = (x: number): number => m.e + ((x - xMin) / Math.max(1e-9, xMax - xMin)) * lw
  const py = (y: number): number => m.t + lh - (y / yMax) * lh
  const passoX = passoRedondo(xMax - xMin, 10)
  const passoY = passoRedondo(yMax, 5)
  let grade = ''
  for (let x = Math.ceil(xMin / passoX) * passoX; x <= xMax + 1e-9; x += passoX)
    grade += `<line x1="${px(x)}" x2="${px(x)}" y1="${m.t}" y2="${m.t + lh}" stroke="${C.linha}" stroke-width="0.6"/><text x="${px(x)}" y="${H - 16}" text-anchor="middle" font-size="9" fill="${C.apoio}">${cm(x)}</text>`
  for (let y = 0; y <= yMax + 1e-9; y += passoY)
    grade += `<line x1="${m.e}" x2="${m.e + lw}" y1="${py(y)}" y2="${py(y)}" stroke="${C.linha}" stroke-width="0.6"/><text x="${m.e - 6}" y="${py(y) + 3}" text-anchor="end" font-size="9" fill="${C.apoio}">${num(y)}</text>`
  const pontos = f.linhas
    .map((l) => `${px(l.leitura).toFixed(1)},${py(l.litros).toFixed(1)}`)
    .join(' ')
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Ábaco: litros para cada leitura da régua">
    ${grade}
    <rect x="${m.e}" y="${m.t}" width="${lw}" height="${lh}" fill="none" stroke="${C.linhaForte}" stroke-width="0.8"/>
    <polyline points="${pontos}" fill="none" stroke="${C.curva}" stroke-width="1.8"/>
    <text x="${m.e + lw / 2}" y="${H - 3}" text-anchor="middle" font-size="9.5" fill="${C.tinta}">${f.leituraPor === 'vazio' ? 'Vazio lido na régua (cm)' : 'Altura lida na régua (cm)'}</text>
    <text x="12" y="${m.t + lh / 2}" text-anchor="middle" font-size="9.5" fill="${C.tinta}" transform="rotate(-90 12 ${m.t + lh / 2})">Litros</text>
  </svg>`
}

/** Linha destacada: a régua múltipla de 5 cm (como se procura na tabela); com régua quebrada, uma a cada cinco. */
const destaque = (l: LinhaFolhaTanque, i: number): boolean =>
  Number.isInteger(l.leitura) ? l.leitura % 5 === 0 : i % 5 === 4

function bloco(linhas: LinhaFolhaTanque[]): string {
  const corpo = linhas
    .map(
      (l, i) =>
        `<tr${destaque(l, i) ? ' class="quinta"' : ''}><td>${cm(l.leitura)}</td><td>${num(l.litros)}</td><td>${l.litrosPorCm > 0 ? num(l.litrosPorCm, 1) : '—'}</td></tr>`
    )
    .join('')
  return `<table><thead><tr><th>Régua</th><th>Litros</th><th>L/cm</th></tr></thead><tbody>${corpo}</tbody></table>`
}

/** HTML completo da folha de controle do tanque, pronto para `printHtmlToPdf`. Cabe numa página A4. */
export function htmlTabelaTanque(f: FolhaTanque): string {
  const titulo = `Tabela de arqueação - ${f.tanque}`
  const hoje = new Date().toLocaleDateString('pt-BR')
  const regua =
    f.leituraPor === 'vazio'
      ? `A régua mede o vazio, da boca de medição até o líquido (boca a ${cm(f.alturaReferenciaCm ?? 0)} cm do fundo).`
      : 'A régua mede a altura do líquido, do fundo para cima.'
  const arranjo = arranjoDaFolha(f.linhas.length)
  const linhas = linhasDoPasso(f.linhas, arranjo.passoCm)
  const colunas: LinhaFolhaTanque[][] = []
  for (let c = 0; c < arranjo.colunas; c++) {
    const col = linhas.slice(c * arranjo.linhasPorColuna, (c + 1) * arranjo.linhasPorColuna)
    if (col.length > 0) colunas.push(col)
  }
  // a letra acompanha a altura da linha e a largura da coluna (três números lado a lado)
  const larguraColuna =
    (LARGURA_UTIL - ESPACO_ENTRE_COLUNAS * (arranjo.colunas - 1)) / arranjo.colunas
  const letra = Math.min(arranjo.alturaLinha * 0.74, larguraColuna / 11.5, 2.6)
  const avisoPasso =
    arranjo.passoCm > 1
      ? ` A tabela sai de ${arranjo.passoCm} em ${arranjo.passoCm} cm para caber numa página; o ábaco e o sistema têm todos os centímetros.`
      : ''
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { width: ${LARGURA_UTIL}mm; font: 10px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif; color: ${C.tinta}; }
  .folha { height: ${ALTURA_UTIL - 1}mm; overflow: hidden; display: flex; flex-direction: column; }
  h1 { font-size: 15px; margin: 0 0 1px; }
  .sub { color: ${C.apoio}; font-size: 10px; }
  dl { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px 14px; margin: 5px 0 3px; }
  dt { color: ${C.apoio}; font-size: 8px; text-transform: uppercase; letter-spacing: .06em; }
  dd { margin: 0; font-size: 10.5px; font-weight: 600; }
  .larga { grid-column: 1 / -1; }
  .abaco { border: 1px solid ${C.linha}; padding: 2px 3px 0; margin: 3px 0 4px; }
  .abaco svg { display: block; }
  .tabelas { display: grid; grid-template-columns: repeat(${arranjo.colunas}, 1fr); gap: 0 ${ESPACO_ENTRE_COLUNAS}mm; align-items: start; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; table-layout: fixed; }
  tr { height: ${arranjo.alturaLinha.toFixed(3)}mm; }
  th, td { font-size: ${letra.toFixed(3)}mm; line-height: 1; padding: 0 1mm; text-align: right; overflow: hidden; white-space: nowrap; }
  th { font-size: ${(letra * 0.82).toFixed(3)}mm; text-transform: uppercase; letter-spacing: .03em;
       border-bottom: 0.3mm solid ${C.linhaForte}; color: ${C.apoio}; }
  td { border-bottom: 0.12mm solid ${C.linha}; }
  td:first-child { font-weight: 700; }
  tr.quinta td { background: ${C.faixa}; border-bottom: 0.2mm solid ${C.linhaForte}; }
  .nota { margin: 3px 0 0; color: ${C.apoio}; font-size: 8px; line-height: 1.25; }
</style></head><body><div class="folha">
  <h1>${esc(f.tanque)}</h1>
  <div class="sub">Tabela de controle do tanque · ${esc(f.obra)} · emitida em ${hoje}</div>
  <dl>
    <div><dt>Material</dt><dd>${esc(f.material)}</dd></div>
    <div><dt>Formato</dt><dd>${esc(f.formato)}</dd></div>
    <div><dt>Capacidade</dt><dd>${num(f.capacidadeLitros)} L</dd></div>
    <div class="larga"><dt>Medidas internas</dt><dd>${esc(f.medidas)}</dd></div>
    <div class="larga"><dt>Régua</dt><dd>${esc(regua)}</dd></div>
  </dl>
  <div class="abaco">${abaco(f)}</div>
  <section class="tabelas">${colunas.map(bloco).join('')}</section>
  <p class="nota">Régua em cm. "L/cm" é o volume do centímetro de líquido que termina naquela linha: quando o nível
  baixa 1 cm a partir dela, sai esse volume.${avisoPasso} Os litros são calculados das medidas do cadastro; confira com
  a placa do tanque. Tanque desnivelado, serpentina e isolamento interno mudam o volume real.</p>
</div></body></html>`
}

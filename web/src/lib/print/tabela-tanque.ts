// Folha de controle do tanque para imprimir (A4 em pé): cabeçalho, ábaco (curva régua × litros) e a tabela
// centímetro a centímetro. As cores são fixas de impressão, como nos outros documentos desta pasta.

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
  /** em ordem crescente da leitura */
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

const COLUNAS = 4
const LINHAS_PRIMEIRA = 30
const LINHAS_DEMAIS = 58

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

function abaco(f: FolhaTanque): string {
  const W = 700
  const H = 250
  const m = { e: 62, d: 14, t: 10, b: 34 }
  const lw = W - m.e - m.d
  const lh = H - m.t - m.b
  const xs = f.linhas.map((l) => l.leitura)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMax = Math.max(f.capacidadeLitros, 1)
  const px = (x: number): number => m.e + ((x - xMin) / Math.max(1e-9, xMax - xMin)) * lw
  const py = (y: number): number => m.t + lh - (y / yMax) * lh
  const passoX = passoRedondo(xMax - xMin, 10)
  const passoY = passoRedondo(yMax, 6)
  let grade = ''
  for (let x = Math.ceil(xMin / passoX) * passoX; x <= xMax + 1e-9; x += passoX)
    grade += `<line x1="${px(x)}" x2="${px(x)}" y1="${m.t}" y2="${m.t + lh}" stroke="${C.linha}" stroke-width="0.6"/><text x="${px(x)}" y="${H - 18}" text-anchor="middle" font-size="9" fill="${C.apoio}">${cm(x)}</text>`
  for (let y = 0; y <= yMax + 1e-9; y += passoY)
    grade += `<line x1="${m.e}" x2="${m.e + lw}" y1="${py(y)}" y2="${py(y)}" stroke="${C.linha}" stroke-width="0.6"/><text x="${m.e - 6}" y="${py(y) + 3}" text-anchor="end" font-size="9" fill="${C.apoio}">${num(y)}</text>`
  const pontos = f.linhas
    .map((l) => `${px(l.leitura).toFixed(1)},${py(l.litros).toFixed(1)}`)
    .join(' ')
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Ábaco: litros para cada leitura da régua">
    ${grade}
    <rect x="${m.e}" y="${m.t}" width="${lw}" height="${lh}" fill="none" stroke="${C.linhaForte}" stroke-width="0.8"/>
    <polyline points="${pontos}" fill="none" stroke="${C.curva}" stroke-width="1.8"/>
    <text x="${m.e + lw / 2}" y="${H - 4}" text-anchor="middle" font-size="9.5" fill="${C.tinta}">${f.leituraPor === 'vazio' ? 'Vazio lido na régua (cm)' : 'Altura lida na régua (cm)'}</text>
    <text x="12" y="${m.t + lh / 2}" text-anchor="middle" font-size="9.5" fill="${C.tinta}" transform="rotate(-90 12 ${m.t + lh / 2})">Litros</text>
  </svg>`
}

function bloco(linhas: LinhaFolhaTanque[]): string {
  const corpo = linhas
    .map(
      (l, i) =>
        `<tr${i % 5 === 4 ? ' class="quinta"' : ''}><td>${cm(l.leitura)}</td><td>${num(l.litros)}</td><td>${l.litrosPorCm > 0 ? num(l.litrosPorCm, 1) : '—'}</td></tr>`
    )
    .join('')
  return `<table><thead><tr><th>Régua (cm)</th><th>Litros</th><th>L por cm</th></tr></thead><tbody>${corpo}</tbody></table>`
}

/** Divide as linhas em páginas de quatro colunas; a primeira página tem menos linhas, por causa do cabeçalho. */
function paginas(linhas: LinhaFolhaTanque[]): LinhaFolhaTanque[][][] {
  const out: LinhaFolhaTanque[][][] = []
  let i = 0
  let primeira = true
  while (i < linhas.length) {
    const porColuna = primeira ? LINHAS_PRIMEIRA : LINHAS_DEMAIS
    const fatia = linhas.slice(i, i + porColuna * COLUNAS)
    // distribui a fatia em colunas de tamanho igual, lidas de cima para baixo
    const n = Math.ceil(fatia.length / COLUNAS)
    const colunas: LinhaFolhaTanque[][] = []
    for (let c = 0; c < COLUNAS; c++) {
      const col = fatia.slice(c * n, (c + 1) * n)
      if (col.length > 0) colunas.push(col)
    }
    out.push(colunas)
    i += fatia.length
    primeira = false
  }
  return out
}

/** HTML completo da folha de controle do tanque, pronto para `printHtmlToPdf`. */
export function htmlTabelaTanque(f: FolhaTanque): string {
  const titulo = `Tabela de arqueação - ${f.tanque}`
  const hoje = new Date().toLocaleDateString('pt-BR')
  const regua =
    f.leituraPor === 'vazio'
      ? `A régua mede o vazio, da boca de medição até o líquido (boca a ${cm(f.alturaReferenciaCm ?? 0)} cm do fundo).`
      : 'A régua mede a altura do líquido, do fundo para cima.'
  const tabelas = paginas(f.linhas)
    .map(
      (colunas, p) =>
        `<section class="tabelas${p > 0 ? ' nova' : ''}">${colunas.map(bloco).join('')}</section>`
    )
    .join('')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 10px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif; color: ${C.tinta}; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .sub { color: ${C.apoio}; font-size: 10.5px; }
  dl { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 14px; margin: 8px 0 6px; }
  dt { color: ${C.apoio}; font-size: 8.5px; text-transform: uppercase; letter-spacing: .06em; }
  dd { margin: 0; font-size: 11px; font-weight: 600; }
  .larga { grid-column: 1 / -1; }
  .abaco { border: 1px solid ${C.linha}; padding: 4px 4px 0; margin: 6px 0 8px; }
  .tabelas { display: grid; grid-template-columns: repeat(${COLUNAS}, 1fr); gap: 0 8px; align-items: start; }
  .tabelas.nova { break-before: page; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th { font-size: 8px; text-transform: uppercase; letter-spacing: .04em; text-align: right; padding: 2px 4px;
       border-bottom: 1.2px solid ${C.linhaForte}; color: ${C.apoio}; }
  td { text-align: right; padding: 1.2px 4px; border-bottom: 0.5px solid ${C.linha}; }
  td:first-child { font-weight: 700; }
  tr.quinta td { background: ${C.faixa}; border-bottom: 0.8px solid ${C.linhaForte}; }
  .nota { margin-top: 8px; color: ${C.apoio}; font-size: 9px; }
</style></head><body>
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
  ${tabelas}
  <p class="nota">"L por cm" é o volume do centímetro de líquido que termina naquela linha: quando o nível baixa
  1 cm a partir dela, sai esse volume. Os litros são calculados das medidas informadas no cadastro; confira com a placa
  do tanque. Tanque desnivelado, serpentina e isolamento interno mudam o volume real.</p>
</body></html>`
}

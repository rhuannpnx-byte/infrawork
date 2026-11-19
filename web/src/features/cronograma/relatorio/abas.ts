/** Abas de tabela do relatório de viabilidade: premissas, orçamento, agrupadores, composições e histogramas. */
import type { Fill, Workbook, Worksheet } from 'exceljs'
import { larguraParaPx } from '@/lib/excel/desenho-xlsx'
import type { RecursoGrupo } from '@/types/orcamento'
import type { RecursoHistograma } from '../visoes/histograma'
import type { DadosViabilidade } from './tipos'

const COR = {
  cabecalho: '1F2937',
  branco: 'FFFFFF',
  grupo: 'E5E7EB',
  faixa: 'F3F4F6',
  marca: 'DBE4F5',
  linha: 'E5E7EB',
  texto: '111827',
  fraco: '6B7280',
  negativo: 'B91C1C'
}
const MOEDA = 'R$ #,##0.00'
const NUM = '#,##0.00'
const PCT = '0.00%'

const argb = (c: string): { argb: string } => ({ argb: `FF${c}` })
const fundo = (c: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: argb(c) })
const dataBR = (iso: string | null | undefined): string =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—'
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

type Valor = string | number | null
interface Coluna {
  titulo: string
  px: number
  formato?: string
  alinhamento?: 'left' | 'right' | 'center'
}
interface Linha {
  valores: Valor[]
  /** grupo = faixa de título; total = soma em negrito; sub = detalhe em tom fraco. */
  estilo?: 'grupo' | 'total' | 'sub'
  recuo?: number
  /** Índices de coluna em vermelho (resultado negativo). */
  negativos?: number[]
}

function subtitulo(d: DadosViabilidade): string {
  const quando = d.geradoEm.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  return `${d.obra.codigo} · ${d.obra.nome}   |   Plano: ${d.plano.nome} (${d.plano.situacao})   |   Gerado em ${quando}`
}

function novaAba(wb: Workbook, nome: string, titulo: string, d: DadosViabilidade): Worksheet {
  const ws = wb.addWorksheet(nome, {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  })
  ws.getCell(1, 1).value = titulo
  ws.getCell(1, 1).font = { bold: true, size: 13, color: argb(COR.texto) }
  ws.getCell(2, 1).value = subtitulo(d)
  ws.getCell(2, 1).font = { size: 9, color: argb(COR.fraco) }
  ws.getRow(1).height = 22
  return ws
}

function larguras(ws: Worksheet, colunas: Coluna[]): void {
  colunas.forEach((c, i) => {
    const col = ws.getColumn(i + 1)
    col.width = Math.max(col.width ?? 0, larguraParaPx(c.px))
  })
}

/** Escreve o cabeçalho e as linhas a partir de `linha`; devolve a próxima linha livre. */
function tabela(ws: Worksheet, linha: number, colunas: Coluna[], linhas: Linha[]): number {
  larguras(ws, colunas)
  colunas.forEach((c, i) => {
    const cel = ws.getCell(linha, i + 1)
    cel.value = c.titulo
    cel.font = { bold: true, size: 9, color: argb(COR.branco) }
    cel.fill = fundo(COR.cabecalho)
    cel.alignment = { vertical: 'middle', horizontal: c.alinhamento ?? 'left', wrapText: true }
  })
  ws.getRow(linha).height = 24
  let r = linha + 1
  for (const l of linhas) {
    colunas.forEach((c, i) => {
      const cel = ws.getCell(r, i + 1)
      const v = l.valores[i] ?? null
      cel.value = v
      if (typeof v === 'number' && c.formato) cel.numFmt = c.formato
      cel.font = {
        size: 9,
        bold: l.estilo === 'grupo' || l.estilo === 'total',
        color: argb(
          l.negativos?.includes(i) ? COR.negativo : l.estilo === 'sub' ? COR.fraco : COR.texto
        )
      }
      cel.alignment = {
        vertical: 'middle',
        horizontal: c.alinhamento ?? 'left',
        indent: i <= 1 && l.recuo ? Math.min(l.recuo, 12) : 0
      }
      cel.border = { bottom: { style: 'thin', color: argb(COR.linha) } }
      if (l.estilo === 'grupo') cel.fill = fundo(COR.grupo)
      if (l.estilo === 'total') cel.fill = fundo(COR.faixa)
    })
    r++
  }
  return r
}

function secao(ws: Worksheet, linha: number, texto: string, nota?: string): number {
  ws.getCell(linha, 1).value = texto
  ws.getCell(linha, 1).font = { bold: true, size: 11, color: argb(COR.texto) }
  if (nota) {
    ws.getCell(linha + 1, 1).value = nota
    ws.getCell(linha + 1, 1).font = { size: 9, italic: true, color: argb(COR.fraco) }
    return linha + 2
  }
  return linha + 1
}

/** Pares rótulo/valor; `colValor` é a coluna do valor (o rótulo ocupa as anteriores, mescladas). */
function ficha(
  ws: Worksheet,
  linha: number,
  pares: Array<[string, Valor, string?]>,
  colValor = 2,
  ateCol = colValor
): number {
  let r = linha
  for (const [rotulo, valor, formato] of pares) {
    if (colValor > 2) ws.mergeCells(r, 1, r, colValor - 1)
    if (ateCol > colValor) ws.mergeCells(r, colValor, r, ateCol)
    ws.getCell(r, 1).value = rotulo
    ws.getCell(r, 1).font = { size: 9, color: argb(COR.fraco) }
    const cel = ws.getCell(r, colValor)
    cel.value = valor
    cel.font = {
      size: 10,
      bold: true,
      color: argb(typeof valor === 'number' && valor < 0 ? COR.negativo : COR.texto)
    }
    cel.alignment = { horizontal: 'left' }
    if (formato && typeof valor === 'number') cel.numFmt = formato
    r++
  }
  return r
}

const PERIODICIDADE = { dia: 'por dia', mes: 'por mês', ano: 'por ano' } as const
const TIPO_INDIRETO: Record<string, string> = {
  mobilizacao: 'Mobilização',
  desmob: 'Desmobilização',
  admin_local: 'Administração local',
  outros: 'Outros'
}

export function abaPremissas(wb: Workbook, d: DadosViabilidade): void {
  const ws = novaAba(wb, 'Premissas', 'Premissas do plano', d)
  let r = secao(ws, 4, 'Plano')
  r = ficha(ws, r, [
    ['Obra', `${d.obra.codigo} · ${d.obra.nome}`],
    ['Plano', `${d.plano.nome} (${d.plano.situacao})`],
    ['Início', dataBR(d.plano.inicio)],
    ['Término calculado', dataBR(d.plano.fim)],
    ['Prazo do contrato', dataBR(d.plano.prazo)],
    [
      'Calendário',
      d.plano.calendario
        ? `${d.plano.calendario.nome}: ${d.plano.calendario.diasPorSemana} dias por semana, ${d.plano.calendario.jornadaHoras} h por dia`
        : '—'
    ]
  ])

  r = secao(ws, r + 1, 'Taxas', 'Regimes de taxas que entram no resultado deste plano.')
  r = tabela(
    ws,
    r,
    [
      { titulo: 'Regime', px: 230 },
      { titulo: 'ISS', px: 300, formato: PCT, alinhamento: 'right' },
      { titulo: 'PIS', px: 80, formato: PCT, alinhamento: 'right' },
      { titulo: 'COFINS', px: 80, formato: PCT, alinhamento: 'right' },
      { titulo: 'CSLL', px: 80, formato: PCT, alinhamento: 'right' },
      { titulo: 'IRPJ', px: 80, formato: PCT, alinhamento: 'right' },
      { titulo: 'CPRB', px: 80, formato: PCT, alinhamento: 'right' },
      { titulo: 'Outros', px: 80, formato: PCT, alinhamento: 'right' },
      { titulo: 'Total', px: 90, formato: PCT, alinhamento: 'right' },
      { titulo: 'Vigência', px: 150 },
      { titulo: 'Onde entra', px: 330 }
    ],
    d.taxas.length
      ? d.taxas.map((t) => ({
          valores: [
            t.nome,
            Number(t.iss_perc),
            Number(t.pis_perc),
            Number(t.cofins_perc),
            Number(t.csll_perc),
            Number(t.irpj_perc),
            Number(t.cprb_perc),
            Number(t.outros_perc),
            Number(t.total_perc_calc),
            t.vigencia_inicio || t.vigencia_fim
              ? `${dataBR(t.vigencia_inicio)} a ${dataBR(t.vigencia_fim)}`
              : 'Sem prazo',
            t.uso
          ]
        }))
      : [{ valores: ['Nenhum regime de taxas vigente na obra.'], estilo: 'sub' }]
  )

  r = secao(ws, r + 1, 'Custo indireto cadastrado', 'Valor na obra = valor total × distribuição.')
  const totalIndireto = d.indiretoCadastro.reduce(
    (s, i) => s + Number(i.valor_total ?? 0) * Number(i.distribuicao_perc ?? 1),
    0
  )
  r = tabela(
    ws,
    r,
    [
      { titulo: 'Código', px: 230 },
      { titulo: 'Descrição', px: 300 },
      { titulo: 'Tipo', px: 80 },
      { titulo: 'Valor total', px: 80, formato: MOEDA, alinhamento: 'right' },
      { titulo: 'Distribuição', px: 80, formato: PCT, alinhamento: 'right' },
      { titulo: 'Valor na obra', px: 80, formato: MOEDA, alinhamento: 'right' }
    ],
    d.indiretoCadastro.length
      ? [
          ...d.indiretoCadastro.map((i) => ({
            valores: [
              i.codigo,
              i.descricao,
              TIPO_INDIRETO[i.tipo] ?? i.tipo,
              Number(i.valor_total ?? 0),
              Number(i.distribuicao_perc ?? 1),
              Number(i.valor_total ?? 0) * Number(i.distribuicao_perc ?? 1)
            ] as Valor[],
            recuo: i.parent_id ? 1 : 0
          })),
          { valores: ['Total', null, null, null, null, totalIndireto], estilo: 'total' as const }
        ]
      : [{ valores: ['Nenhum custo indireto cadastrado.'], estilo: 'sub' }]
  )

  if (d.indiretoPlano.length) {
    r = secao(
      ws,
      r + 1,
      'Indireto no plano',
      'Tarefas de indireto do cronograma, na janela calculada.'
    )
    tabela(
      ws,
      r,
      [
        { titulo: 'Tarefa', px: 230 },
        { titulo: 'Período', px: 300 },
        { titulo: 'Dias úteis', px: 80, formato: NUM, alinhamento: 'right' },
        { titulo: 'Períodos', px: 80, formato: NUM, alinhamento: 'right' },
        { titulo: 'Cobrança', px: 80 },
        { titulo: 'Custo por período', px: 80, formato: MOEDA, alinhamento: 'right' },
        { titulo: 'Custo total', px: 80, formato: MOEDA, alinhamento: 'right' },
        { titulo: 'Receita', px: 80, formato: MOEDA, alinhamento: 'right' },
        { titulo: 'Taxas', px: 90, formato: MOEDA, alinhamento: 'right' }
      ],
      d.indiretoPlano.map((i) => ({
        valores: [
          i.nome,
          i.inicio ? `${dataBR(i.inicio)} a ${dataBR(i.fim)}` : 'Sem janela calculada',
          i.diasUteis,
          i.periodos,
          PERIODICIDADE[i.periodicidade],
          i.custoUnitario,
          i.custoTotal,
          i.receitaTotal,
          i.custoTaxas
        ]
      }))
    )
  }
  // as tabelas dividem as colunas: larguras que servem a todas
  ;[230, 300, 110, 110, 110, 120, 120, 110, 110, 150, 330].forEach(
    (px, i) => (ws.getColumn(i + 1).width = larguraParaPx(px))
  )
}

export function abaOrcamento(wb: Workbook, d: DadosViabilidade): void {
  const ws = novaAba(wb, 'Orçamento', 'Orçamento e rentabilidade', d)
  const res = d.resumo
  let r = secao(ws, 4, 'Resultado da obra')
  r = ficha(
    ws,
    r,
    [
      ['Venda total', res.venda_total, MOEDA],
      ['Custo direto', res.custo_direto, MOEDA],
      ['Custo indireto', res.custo_indireto, MOEDA],
      [
        `Impostos (${(res.aliquota_total_perc * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} % da venda)`,
        res.impostos,
        MOEDA
      ],
      ['Lucro líquido', res.lucro_liquido, MOEDA],
      ['Margem', res.margem_perc, PCT]
    ],
    3,
    5
  )
  r = secao(
    ws,
    r + 1,
    'Planilha orçamentária',
    'Resultado = venda − custo direto de cada item; a margem da obra, acima, já desconta indireto e impostos.'
  )
  const cabecalho = r
  tabela(
    ws,
    r,
    [
      { titulo: 'Código', px: 110 },
      { titulo: 'Descrição', px: 430 },
      { titulo: 'Un.', px: 50, alinhamento: 'center' },
      { titulo: 'Quantidade', px: 110, formato: NUM, alinhamento: 'right' },
      { titulo: 'Venda unit.', px: 110, formato: MOEDA, alinhamento: 'right' },
      { titulo: 'Venda total', px: 130, formato: MOEDA, alinhamento: 'right' },
      { titulo: 'Custo total', px: 130, formato: MOEDA, alinhamento: 'right' },
      { titulo: 'Resultado', px: 130, formato: MOEDA, alinhamento: 'right' },
      { titulo: 'Margem', px: 80, formato: PCT, alinhamento: 'right' }
    ],
    d.orcamento.map((i) => {
      const venda = Number(i.venda_total_calc ?? 0)
      const custo = Number(i.custo_total_calc ?? 0)
      const etapa = i.tipo === 'etapa'
      return {
        valores: [
          i.codigo,
          i.descricao,
          etapa ? null : i.unidade,
          etapa ? null : i.quantidade === null ? null : Number(i.quantidade),
          etapa ? null : i.venda_unitaria === null ? null : Number(i.venda_unitaria),
          venda,
          custo,
          venda - custo,
          i.lucratividade_perc_calc === null ? null : Number(i.lucratividade_perc_calc)
        ],
        estilo: etapa ? ('grupo' as const) : undefined,
        recuo: i.depth,
        negativos: venda - custo < 0 ? [7, 8] : undefined
      }
    })
  )
  ws.views = [{ state: 'frozen', ySplit: cabecalho, showGridLines: false }]
}

export function abaAgrupadores(wb: Workbook, d: DadosViabilidade): void {
  const ws = novaAba(wb, 'Agrupadores', 'Agrupadores (serviços do orçamento)', d)
  ws.getCell(3, 1).value =
    'Cada agrupador reúne as receitas abaixo dele, no rateio indicado, e é executado pela composição da última coluna.'
  ws.getCell(3, 1).font = { size: 9, italic: true, color: argb(COR.fraco) }
  const linhas: Linha[] = []
  for (const a of d.agrupadores) {
    const venda = Number(a.item.venda_total_calc ?? 0)
    const custo = Number(a.item.custo_total_calc ?? 0)
    linhas.push({
      valores: [
        a.item.codigo,
        a.item.descricao,
        a.item.unidade_referencia ?? a.item.unidade,
        a.item.quantidade_referencia === null ? null : Number(a.item.quantidade_referencia),
        null,
        venda,
        a.item.custo_unitario_calc === null ? null : Number(a.item.custo_unitario_calc),
        custo,
        venda - custo,
        a.item.lucratividade_perc_calc === null ? null : Number(a.item.lucratividade_perc_calc),
        a.servico
          ? `${a.servico.codigo} · ${a.servico.nome}`
          : a.item.indireto_id
            ? 'Custo indireto'
            : 'Sem composição'
      ],
      estilo: 'grupo',
      negativos: venda - custo < 0 ? [8, 9] : undefined
    })
    for (const rc of a.receitas)
      linhas.push({
        valores: [rc.codigo, rc.descricao, null, null, rc.fracao, rc.vendaTotal],
        estilo: 'sub',
        recuo: 1
      })
  }
  tabela(
    ws,
    5,
    [
      { titulo: 'Código', px: 110 },
      { titulo: 'Agrupador / receita', px: 420 },
      { titulo: 'Un.', px: 50, alinhamento: 'center' },
      { titulo: 'Quantidade', px: 110, formato: NUM, alinhamento: 'right' },
      { titulo: 'Rateio', px: 70, formato: PCT, alinhamento: 'right' },
      { titulo: 'Venda', px: 130, formato: MOEDA, alinhamento: 'right' },
      { titulo: 'Custo unit.', px: 110, formato: MOEDA, alinhamento: 'right' },
      { titulo: 'Custo total', px: 130, formato: MOEDA, alinhamento: 'right' },
      { titulo: 'Resultado', px: 130, formato: MOEDA, alinhamento: 'right' },
      { titulo: 'Margem', px: 80, formato: PCT, alinhamento: 'right' },
      { titulo: 'Composição', px: 320 }
    ],
    linhas.length ? linhas : [{ valores: ['Nenhum agrupador no orçamento.'], estilo: 'sub' }]
  )
  ws.views = [{ state: 'frozen', ySplit: 5, showGridLines: false }]
}

const GRUPO_ITEM = {
  MO: 'Mão de obra',
  EQUIPAMENTO: 'Equipamento',
  MATERIAL: 'Material',
  COMBUSTIVEL: 'Combustível'
} as const

export function abaComposicoes(wb: Workbook, d: DadosViabilidade): void {
  const ws = novaAba(wb, 'Composições', 'Composições de custo', d)
  ws.getCell(3, 1).value =
    'Uma faixa por composição, com a produção diária e o custo unitário; abaixo, os recursos e o custo por dia de cada um.'
  ws.getCell(3, 1).font = { size: 9, italic: true, color: argb(COR.fraco) }
  const linhas: Linha[] = []
  for (const c of d.composicoes) {
    const vinculo =
      c.fator !== 1
        ? ` (${c.operacao === 'multiplicar' ? '×' : '÷'} ${c.fator.toLocaleString('pt-BR')})`
        : ''
    linhas.push({
      valores: [
        c.servico.codigo,
        `${c.servico.nome}${c.nome && c.nome !== c.servico.nome ? ` — ${c.nome}` : ''}${vinculo}`,
        c.unidadeProducao || c.servico.unidade,
        c.producaoDiaria,
        null,
        null,
        null,
        c.custoUnitario,
        c.custoEquipamentoDia + c.custoCombustivelDia + c.custoMaoDeObraDia + c.custoMaterialDia
      ],
      estilo: 'grupo'
    })
    for (const it of c.itens)
      linhas.push({
        valores: [
          GRUPO_ITEM[it.grupo],
          it.recurso,
          it.unidade,
          it.quantidade,
          it.horasDia,
          it.consumoCombustivelLh,
          it.consumoMaterialPorUnid,
          it.preco,
          it.custoDia
        ],
        recuo: 1
      })
  }
  tabela(
    ws,
    5,
    [
      { titulo: 'Serviço / grupo', px: 120 },
      { titulo: 'Composição / recurso', px: 420 },
      { titulo: 'Un.', px: 60, alinhamento: 'center' },
      { titulo: 'Produção por dia / quantidade', px: 120, formato: NUM, alinhamento: 'right' },
      { titulo: 'Horas por dia', px: 80, formato: NUM, alinhamento: 'right' },
      { titulo: 'Combustível (l/h)', px: 90, formato: NUM, alinhamento: 'right' },
      { titulo: 'Material por unidade', px: 100, formato: '#,##0.0000', alinhamento: 'right' },
      { titulo: 'Custo unitário / preço', px: 120, formato: MOEDA, alinhamento: 'right' },
      { titulo: 'Custo por dia', px: 130, formato: MOEDA, alinhamento: 'right' }
    ],
    linhas.length
      ? linhas
      : [{ valores: ['Nenhuma composição ligada aos serviços.'], estilo: 'sub' }]
  )
  ws.views = [{ state: 'frozen', ySplit: 5, showGridLines: false }]
}

interface DefHistograma {
  aba: string
  titulo: string
  grupo: RecursoGrupo
  /** Contagem (pessoas, máquinas): mostra o pico e soma a semana. Quantidade: mostra o total do recurso. */
  contagem: boolean
  nota: string
}
const HISTOGRAMAS: DefHistograma[] = [
  {
    aba: 'Mão de obra',
    titulo: 'Histograma de mão de obra',
    grupo: 'MO',
    contagem: true,
    nota: 'Pessoas necessárias em cada semana (pico da semana), pelas equipes das composições.'
  },
  {
    aba: 'Equipamentos',
    titulo: 'Histograma de equipamentos',
    grupo: 'MVE',
    contagem: true,
    nota: 'Equipamentos necessários em cada semana (pico da semana), pelas equipes das composições.'
  },
  {
    aba: 'Materiais',
    titulo: 'Histograma de materiais',
    grupo: 'MATERIAL',
    contagem: false,
    nota: 'Consumo de cada material por semana, na unidade do material. As linhas não são somadas porque as unidades diferem.'
  },
  {
    aba: 'Combustíveis',
    titulo: 'Histograma de combustíveis',
    grupo: 'COMBUSTIVEL',
    contagem: false,
    nota: 'Consumo por semana: litros por hora dos equipamentos × horas por dia × dias com produção.'
  }
]

function abaHistograma(wb: Workbook, d: DadosViabilidade, def: DefHistograma): void {
  const ws = novaAba(wb, def.aba, def.titulo, d)
  ws.getCell(3, 1).value = def.nota
  ws.getCell(3, 1).font = { size: 9, italic: true, color: argb(COR.fraco) }
  const semanas = d.histograma.semanas
  const recursos: RecursoHistograma[] = d.histograma.recursos
    .filter((x) => x.grupo === def.grupo)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  const FIXAS = 3
  ;[340, 60, 100].forEach((px, i) => (ws.getColumn(i + 1).width = larguraParaPx(px)))
  semanas.forEach((_, j) => (ws.getColumn(FIXAS + 1 + j).width = larguraParaPx(52)))

  // cabeçalho: mês (linha 5) e segunda-feira da semana (linha 6)
  const estiloCab = (lin: number, col: number): void => {
    const cel = ws.getCell(lin, col)
    cel.font = { bold: true, size: 9, color: argb(COR.branco) }
    cel.fill = fundo(COR.cabecalho)
    cel.alignment = { vertical: 'middle', horizontal: col <= 1 ? 'left' : 'center' }
  }
  ;['Recurso', 'Un.', def.contagem ? 'Pico' : 'Total'].forEach((t, i) => {
    ws.mergeCells(5, i + 1, 6, i + 1)
    ws.getCell(5, i + 1).value = t
    estiloCab(5, i + 1)
  })
  let ini = 0
  for (let j = 0; j <= semanas.length; j++) {
    const mudou =
      j === semanas.length || (j > 0 && semanas[j].slice(0, 7) !== semanas[j - 1].slice(0, 7))
    if (j < semanas.length) {
      const c = FIXAS + 1 + j
      ws.getCell(6, c).value = `${semanas[j].slice(8, 10)}/${semanas[j].slice(5, 7)}`
      estiloCab(5, c)
      estiloCab(6, c)
      ws.getCell(6, c).font = { size: 8, color: argb(COR.branco) }
    }
    if (mudou && j > 0) {
      if (j - 1 > ini) ws.mergeCells(5, FIXAS + 1 + ini, 5, FIXAS + j)
      const ref = semanas[ini]
      ws.getCell(5, FIXAS + 1 + ini).value =
        `${MESES[Number(ref.slice(5, 7)) - 1]}/${ref.slice(2, 4)}`
      ini = j
    }
  }

  // inteiro sem casas; fração com uma ou duas (o formato '#,##0.##' deixa a vírgula sobrando no inteiro)
  const formatoDe = (v: number): string =>
    def.contagem ? (Number.isInteger(Math.round(v * 100) / 100) ? '#,##0' : '#,##0.0#') : NUM
  const linha = (
    r: number,
    nome: string,
    un: string,
    resumo: number,
    valores: number[],
    total: boolean
  ): void => {
    const fixos: Valor[] = [nome, un, resumo]
    fixos.forEach((v, i) => {
      const cel = ws.getCell(r, i + 1)
      cel.value = v
      cel.font = { size: 9, bold: total || i === 2, color: argb(COR.texto) }
      cel.alignment = {
        vertical: 'middle',
        horizontal: i === 0 ? 'left' : i === 1 ? 'center' : 'right'
      }
      cel.border = { bottom: { style: 'thin', color: argb(COR.linha) } }
      if (i === 2) cel.numFmt = formatoDe(resumo)
      if (total) cel.fill = fundo(COR.faixa)
    })
    valores.forEach((v, j) => {
      const cel = ws.getCell(r, FIXAS + 1 + j)
      cel.border = { bottom: { style: 'thin', color: argb(COR.linha) } }
      if (total) cel.fill = fundo(COR.faixa)
      if (!v) return
      cel.value = Math.round(v * 100) / 100
      cel.numFmt = formatoDe(v)
      cel.font = { size: 9, bold: total, color: argb(COR.texto) }
      cel.alignment = { horizontal: 'right', vertical: 'middle' }
      if (!total) cel.fill = fundo(COR.marca)
    })
  }

  let r = 7
  if (recursos.length === 0) {
    ws.getCell(r, 1).value = 'Nenhum recurso deste tipo nas composições do plano.'
    ws.getCell(r, 1).font = { size: 9, color: argb(COR.fraco) }
  }
  for (const rec of recursos) {
    const valores = semanas.map((s) => rec.porSemana[s] ?? 0)
    linha(
      r++,
      rec.nome,
      def.contagem ? 'un' : rec.unidade,
      def.contagem ? rec.pico : rec.total,
      valores,
      false
    )
  }
  // soma só quando todas as linhas estão na mesma unidade (contagem, ou combustível todo em litros)
  const unidades = new Set(recursos.map((x) => (def.contagem ? 'un' : x.unidade)))
  if (recursos.length > 1 && unidades.size === 1) {
    const soma = semanas.map((s) => recursos.reduce((t, x) => t + (x.porSemana[s] ?? 0), 0))
    linha(
      r,
      def.contagem ? 'Total na semana' : 'Total',
      [...unidades][0],
      def.contagem ? Math.max(0, ...soma) : soma.reduce((a, b) => a + b, 0),
      soma,
      true
    )
  }
  ws.views = [{ state: 'frozen', xSplit: FIXAS, ySplit: 6, showGridLines: false }]
}

export function abasHistogramas(wb: Workbook, d: DadosViabilidade): void {
  for (const def of HISTOGRAMAS) abaHistograma(wb, d, def)
}

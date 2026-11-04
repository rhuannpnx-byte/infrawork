import ExcelJS from 'exceljs'
import type { CriterioRateio, ItemAlocacao, ItemOrcamentario, Servico } from '@/types/orcamento'
import type {
  EnumSpec,
  ParseResult,
  ParsedRow,
  RowError,
  TemplateCtx,
  TemplateSpec
} from '../types'
import { resumoDe } from '../types'
import { buildTemplateWorkbook } from '../template-builder'
import { compareCodigo, getSheet, parentCodigo, parseSheet } from '../parse-sheet'
import { estiloHeader, estiloTexto } from '../styles'

/**
 * Modelo v4 da planilha orçamentária — TUDO na aba "Orçamento":
 *   planilha de venda (código, descrição, unidade, quantidade, preço)
 *   + em cada receita o serviço (lista que se alimenta sozinha), se ela
 *   compõe a quantidade do serviço e, num grupo de colunas recolhido, o
 *   rateio entre até 5 serviços (%, Peso ou Venda).
 * A aba "Agrupamentos" é só visualização (fórmulas); a importação lê apenas
 * a aba "Orçamento" e recalcula tudo no sistema. Composição (CPU) não entra
 * no modelo: o vínculo é feito no sistema.
 */

export interface DestinoLinha {
  servico: string
  /** %: percentual; peso: quantidade física; venda: null. */
  valor: number | null
}

export interface OrcamentoLinha {
  row: number
  codigo: string
  descricao: string
  unidade: string | null
  quantidade: number | null
  /** Preço unitário de venda final, como está na planilha de venda. */
  venda_unitaria: number | null
  tipo: 'etapa' | 'receita'
  /** Serviços de destino (vazio = sem agrupamento). */
  destinos: DestinoLinha[]
  criterio: CriterioRateio
  /** Receita compõe a quantidade dos serviços de destino. */
  compoe_qtd: boolean
  /** Fração prévia de cada destino (null = proporcional à venda, calculada no sistema). */
  fracoes: Array<number | null>
  /** Quantidade manual do serviço do 1º destino (coluna "Qtd. manual do serviço"). */
  qtd_servico: number | null
  unid_servico: string | null
}

const ABA = 'Orçamento'
const ABA_AGRUP = 'Agrupamentos'
const ABA_CALC = 'Calc'
const N_SERV = 5
const SERV_COLS = ['G', 'L', 'N', 'P', 'R'] // Serviço, Serviço 2…5
const PARTE_COLS = ['K', 'M', 'O', 'Q', 'S'] // Parte 1…5
const AGRUP_LINHA0 = 6
const AGRUP_MAX = 400

const SIM_NAO_ENUM: EnumSpec = {
  values: ['Sim', 'Não'],
  map: { sim: 'S', nao: 'N' },
  synonyms: { s: 'S', n: 'N', x: 'S', '1': 'S', '0': 'N' }
}

const RATEIO_ENUM: EnumSpec = {
  values: ['%', 'Peso', 'Venda'],
  map: { '%': 'percentual', peso: 'peso', venda: 'venda' },
  synonyms: {
    percentual: 'percentual',
    porcentagem: 'percentual',
    quantidade: 'peso',
    qtd: 'peso',
    fisico: 'peso',
    proporcional: 'venda',
    'proporcional a venda': 'venda'
  }
}
const RATEIO_LABEL: Record<CriterioRateio, string> = {
  percentual: '%',
  peso: 'Peso',
  venda: 'Venda'
}

const q = (c: string, r: number): string => `'${ABA}'!${c}${r}`

const colunasServico = (): TemplateSpec['sheets'][number]['columns'] => {
  const cols: TemplateSpec['sheets'][number]['columns'] = []
  for (let i = 1; i <= N_SERV; i++) {
    if (i > 1)
      cols.push({
        key: `servico${i}`,
        header: `Serviço ${i}`,
        tipo: 'text',
        width: 26,
        listaDinamica: `${ABA_AGRUP}!$A$${AGRUP_LINHA0}:$A$${AGRUP_LINHA0 + AGRUP_MAX - 1}`,
        help: `Rateio: ${i}º serviço de destino desta receita.`
      })
    cols.push({
      key: `parte${i}`,
      header: `Parte ${i}`,
      tipo: 'number',
      min: 0,
      width: 12,
      numFmt: '#,##0.00##',
      help:
        i === 1
          ? 'Rateio: parte do serviço da coluna "Serviço". Em %: percentual (ex.: 18,9). Em Peso: quantidade física (ex.: t × km). Em Venda: deixe vazio.'
          : `Rateio: parte do Serviço ${i} (mesma regra da Parte 1).`
    })
  }
  return cols
}

export const ORCAMENTO_SPEC: TemplateSpec = {
  fileName: 'modelo-orcamento.xlsx',
  titulo: 'Modelo de importação — Planilha orçamentária',
  versao: 'orcamento v4',
  sheets: [
    {
      name: ABA,
      blankRows: 800,
      recolher: { de: 'rateio', ate: 'unid_servico' },
      columns: [
        {
          key: 'codigo',
          header: 'Código',
          required: true,
          tipo: 'code',
          width: 12,
          help: 'Hierárquico com pontos (1, 1.1, 1.1.3), como na planilha de venda. O prefixo define o item pai.'
        },
        {
          key: 'descricao',
          header: 'Descrição',
          required: true,
          tipo: 'text',
          width: 50,
          help: 'Descrição do item da planilha de venda.'
        },
        {
          key: 'unidade',
          header: 'Unidade',
          tipo: 'text',
          width: 9,
          help: 'Unidade contratual (m², m³, t, tkm, un, vb). Vazio junto com quantidade vazia = etapa (título).'
        },
        {
          key: 'quantidade',
          header: 'Quantidade',
          tipo: 'number',
          min: 0,
          width: 14,
          numFmt: '#,##0.00##',
          help: 'Quantidade contratual do item.'
        },
        {
          key: 'preco',
          header: 'Preço unitário de venda',
          tipo: 'number',
          min: 0,
          width: 16,
          numFmt: '#,##0.00',
          help: 'R$ por unidade, exatamente como está na planilha de venda.',
          aliases: ['Preço unitário', 'Preço de venda', 'Preço unitário de venda (sem BDI)']
        },
        {
          key: 'total',
          header: 'Total',
          tipo: 'number',
          width: 16,
          numFmt: '#,##0.00',
          help: 'Quantidade × preço (fórmula).',
          calculada: (r) => `IF(AND(ISNUMBER(D${r}),ISNUMBER(E${r})),D${r}*E${r},"")`
        },
        {
          key: 'servico',
          header: 'Serviço',
          tipo: 'text',
          width: 30,
          listaDinamica: `${ABA_AGRUP}!$A$${AGRUP_LINHA0}:$A$${AGRUP_LINHA0 + AGRUP_MAX - 1}`,
          help: 'Serviço (agrupamento) desta receita. Escolha na lista ou digite um nome novo — ele passa a aparecer na lista e na aba Agrupamentos. Vazio = sem agrupamento.',
          aliases: ['Agrupamento']
        },
        {
          key: 'compoe',
          header: 'Compõe a quantidade',
          tipo: 'enum',
          enum: SIM_NAO_ENUM,
          width: 14,
          help: 'Sim = a quantidade desta receita forma a quantidade do serviço (o serviço soma as receitas marcadas). Ex.: no TSD, só o tratamento é Sim; os transportes são Não.'
        },
        {
          key: 'alocado',
          header: 'Alocado',
          tipo: 'number',
          width: 10,
          numFmt: '0%',
          help: 'Quanto da receita foi para serviços (fórmula): 100% = ok; menos = saldo; 0% = sem agrupamento.',
          calculada: (r) =>
            `IF(G${r}="",IF(F${r}="","",0),IF(COUNTA(L${r},N${r},P${r},R${r})=0,IF(AND(J${r}="%",ISNUMBER(K${r})),MIN(1,K${r}/100),1),IF(J${r}="%",SUM(K${r},M${r},O${r},Q${r},S${r})/100,1)))`
        },
        {
          key: 'rateio',
          header: 'Rateio por',
          tipo: 'enum',
          enum: RATEIO_ENUM,
          width: 11,
          help: 'Só quando a receita vai para mais de um serviço (ou para deixar saldo): % (percentuais), Peso (quantidades físicas, fecha 100%) ou Venda (proporcional à venda das receitas que compõem cada serviço).'
        },
        ...colunasServico(),
        {
          key: 'qtd_servico',
          header: 'Qtd. manual do serviço',
          tipo: 'number',
          min: 0,
          width: 14,
          numFmt: '#,##0.00##',
          help: 'Opcional: quantidade do serviço da coluna "Serviço", quando ela não vem da soma das receitas (ex.: Sinalização = 1 vb). Preencha em uma das receitas do serviço; prevalece sobre o "Compõe".',
          aliases: ['Quantidade manual do serviço', 'Qtd manual']
        },
        {
          key: 'unid_servico',
          header: 'Unidade do serviço',
          tipo: 'text',
          width: 11,
          help: 'Unidade da quantidade manual (obrigatória junto com ela).',
          aliases: ['Unidade manual']
        }
      ]
    }
  ],
  instrucoes: {
    passos: [
      'Cole a planilha de venda na aba "Orçamento" (código, descrição, unidade, quantidade e preço unitário). Linhas sem unidade e sem quantidade são etapas.',
      'Só a planilha de venda? Deixe a coluna "Serviço" vazia e agrupe depois, na tela do sistema.',
      'Agrupando: em cada receita escolha (ou digite) o Serviço e marque "Compõe a quantidade" = Sim nas receitas que formam a quantidade dele.',
      'Rateio: clique no ⊞ acima das colunas para abrir o bloco de rateio, escolha "Rateio por" e preencha os serviços e as partes.',
      'Quantidade manual: no mesmo bloco, preencha "Qtd. manual do serviço" e "Unidade do serviço" em uma das receitas do serviço (ex.: Sinalização = 1 vb).',
      'Confira na aba "Agrupamentos" (só leitura): unidade, quantidade, valor unitário e total de cada serviço, e o quanto da venda já está agrupado.',
      'Importe em Orçamento → Planilha Orçamentária → Importar modelo. O vínculo com a composição (CPU) é feito no sistema.'
    ],
    regras: [
      'Só a aba "Orçamento" é importada; Agrupamentos e as colunas Total/Alocado são calculadas.',
      'O preço de venda é gravado exatamente como está; as receitas mantêm códigos e hierarquia do contrato.',
      'Serviços são identificados pelo nome; nomes iguais (maiúsculas/minúsculas não importam) são o mesmo serviço.',
      'Rateio por %: a soma pode ficar abaixo de 100% (saldo), nunca acima. Por Peso e por Venda sempre fecha 100%.',
      'Quantidade do serviço = soma das receitas com "Compõe = Sim" × a parte rateada; com "Qtd. manual do serviço" preenchida, vale a manual. Sem nenhuma das duas, entra como 1 vb.',
      'A quantidade manual vale para o serviço da coluna "Serviço" daquela linha; se aparecer em mais de uma receita do mesmo serviço, os valores precisam ser iguais.',
      'Até 5 serviços por receita; rateios maiores são feitos no sistema.',
      'Códigos já existentes são pulados por padrão (ou atualizados, se você marcar a opção).'
    ]
  },
  exemplo: [
    {
      sheet: ABA,
      rows: [
        { codigo: '01', descricao: 'TERRAPLENAGEM' },
        ...[
          ['01.01', 'até 50 m', 1200, 8.9],
          ['01.02', '50 a 200 m', 3400, 10.4],
          ['01.03', '200 a 400 m', 2800, 11.8],
          ['01.04', '400 a 600 m', 2100, 13.1],
          ['01.05', '600 a 800 m', 1500, 14.5],
          ['01.06', '800 m a 1 km', 900, 15.9]
        ].map(([codigo, dmt, quantidade, preco]) => ({
          codigo,
          descricao: `Escavação, carga e transporte de argila — DMT ${dmt}`,
          unidade: 'm³',
          quantidade,
          preco,
          servico: 'Escavação, carga e transporte de argila',
          compoe: 'Sim'
        })),
        { codigo: '02', descricao: 'PAVIMENTAÇÃO' },
        {
          codigo: '02.01',
          descricao: 'Sub-base de solo estabilizado',
          unidade: 'm³',
          quantidade: 3200,
          preco: 95.4,
          servico: 'Sub-base',
          compoe: 'Sim'
        },
        {
          codigo: '02.02',
          descricao: 'Base de brita graduada',
          unidade: 'm³',
          quantidade: 2950,
          preco: 199.22,
          servico: 'Base',
          compoe: 'Sim'
        },
        {
          codigo: '02.03',
          descricao: 'Desmatamento e limpeza de jazida',
          unidade: 'm²',
          quantidade: 18000,
          preco: 0.62,
          servico: 'Sub-base',
          rateio: 'Venda',
          servico2: 'Base'
        },
        {
          codigo: '02.04',
          descricao: 'Imprimação com EAI',
          unidade: 'm²',
          quantidade: 48000,
          preco: 5.33,
          servico: 'Imprimação',
          compoe: 'Sim'
        },
        {
          codigo: '02.05',
          descricao: 'Tratamento superficial duplo (TSD)',
          unidade: 'm²',
          quantidade: 12000,
          preco: 14.85,
          servico: 'Tratamento superficial duplo',
          compoe: 'Sim'
        },
        ...[
          ['02.06', 'Transporte comercial de agregados', 16200, 0.62],
          ['02.07', 'Transporte local de agregados', 2880, 1.1]
        ].map(([codigo, descricao, quantidade, preco]) => ({
          codigo,
          descricao,
          unidade: 'tkm',
          quantidade,
          preco,
          servico: 'Tratamento superficial duplo',
          compoe: 'Não'
        })),
        {
          codigo: '02.08',
          descricao: 'Transporte comercial de material betuminoso',
          unidade: 'tkm',
          quantidade: 149960,
          preco: 2.37,
          servico: 'Imprimação',
          compoe: 'Não',
          rateio: 'Peso',
          parte1: 85240.58,
          servico2: 'Tratamento superficial duplo',
          parte2: 64719.42
        },
        { codigo: '03', descricao: 'ADMINISTRAÇÃO E SINALIZAÇÃO' },
        {
          codigo: '03.01',
          descricao: 'Placas de sinalização provisória',
          unidade: 'un',
          quantidade: 120,
          preco: 385,
          servico: 'Sinalização provisória',
          compoe: 'Não',
          qtd_servico: 1,
          unid_servico: 'vb'
        },
        {
          codigo: '03.02',
          descricao: 'Pintura de faixas provisórias',
          unidade: 'm²',
          quantidade: 900,
          preco: 18.5,
          servico: 'Sinalização provisória',
          compoe: 'Não'
        },
        {
          codigo: '03.03',
          descricao: 'Administração local',
          unidade: 'mês',
          quantidade: 18,
          preco: 45000,
          servico: 'Base',
          rateio: '%',
          parte1: 60,
          servico2: 'Sub-base',
          parte2: 30
        }
      ]
    }
  ],
  extras: (wb, info) => montarAbasCalculadas(wb, info.linhas[ABA] ?? 800)
}

/** Aba oculta "Calc" (pilha receita × destino) + aba "Agrupamentos" (só leitura). */
function montarAbasCalculadas(wb: ExcelJS.Workbook, n: number): void {
  const ultimaOrc = n + 1
  const calc = wb.addWorksheet(ABA_CALC, { state: 'veryHidden' })
  ;[
    'Serviço',
    'Fração base',
    'Base venda',
    'Fração',
    'Venda',
    'Qtd',
    'Unidade',
    'Ordem',
    'Cont',
    'Qtd manual',
    'Un manual'
  ].forEach((h, i) => (calc.getCell(1, i + 1).value = h))
  calc.getCell(1, 9).value = 0
  let k = 2
  for (let r = 2; r <= ultimaOrc; r++) {
    const outros = `COUNTA(${q('L', r)},${q('N', r)},${q('P', r)},${q('R', r)})`
    const den = SERV_COLS.map((c, i) =>
      i === 0
        ? `SUMIFS($C:$C,$A:$A,${q(c, r)})`
        : `IF(${q(c, r)}="",0,SUMIFS($C:$C,$A:$A,${q(c, r)}))`
    ).join('+')
    for (let s = 0; s < N_SERV; s++) {
      const serv = q(SERV_COLS[s], r)
      const parte = q(PARTE_COLS[s], r)
      const J = q('J', r)
      calc.getCell(k, 1).value = {
        formula: `IF(${serv}="","",TRIM(${serv}))`
      } as ExcelJS.CellFormulaValue
      // fração para %, Peso e destino único
      calc.getCell(k, 2).value = {
        formula: `IF(A${k}="",0,IF(${outros}=0,IF(AND(${J}="%",ISNUMBER(${q('K', r)})),MIN(1,${q('K', r)}/100),1),IF(${J}="%",N(${parte})/100,IF(${J}="Peso",IFERROR(N(${parte})/SUM(${q('K', r)},${q('M', r)},${q('O', r)},${q('Q', r)},${q('S', r)}),0),0))))`
      } as ExcelJS.CellFormulaValue
      // base do rateio por venda: venda das receitas que compõem (fora do rateio por venda)
      calc.getCell(k, 3).value = {
        formula: `IF(AND(${q('H', r)}="Sim",${J}<>"Venda"),N(${q('F', r)})*B${k},0)`
      } as ExcelJS.CellFormulaValue
      calc.getCell(k, 4).value = {
        formula: `IF(A${k}="",0,IF(AND(${J}="Venda",${outros}>0),IF((${den})=0,1/(1+${outros}),SUMIFS($C:$C,$A:$A,A${k})/(${den})),B${k}))`
      } as ExcelJS.CellFormulaValue
      calc.getCell(k, 5).value = { formula: `N(${q('F', r)})*D${k}` } as ExcelJS.CellFormulaValue
      calc.getCell(k, 6).value = {
        formula: `IF(${q('H', r)}="Sim",N(${q('D', r)})*D${k},0)`
      } as ExcelJS.CellFormulaValue
      calc.getCell(k, 7).value = {
        formula: `IF(AND(A${k}<>"",${q('H', r)}="Sim"),${q('C', r)},"")`
      } as ExcelJS.CellFormulaValue
      calc.getCell(k, 9).value = {
        formula: `N(I${k - 1})+IF(AND(A${k}<>"",COUNTIF(A$2:A${k},A${k})=1),1,0)`
      } as ExcelJS.CellFormulaValue
      calc.getCell(k, 8).value = {
        formula: `IF(AND(A${k}<>"",COUNTIF(A$2:A${k},A${k})=1),I${k},"")`
      } as ExcelJS.CellFormulaValue
      // quantidade manual: vale para o serviço da coluna "Serviço" (1º destino)
      if (s === 0) {
        calc.getCell(k, 10).value = {
          formula: `IF(AND(A${k}<>"",ISNUMBER(${q('T', r)})),${q('T', r)},"")`
        } as ExcelJS.CellFormulaValue
        calc.getCell(k, 11).value = {
          formula: `IF(ISNUMBER(J${k}),TRIM(${q('U', r)}),"")`
        } as ExcelJS.CellFormulaValue
      }
      k++
    }
  }
  const ultimaCalc = k - 1

  // ── Agrupamentos (só leitura) ──
  const ws = wb.addWorksheet(ABA_AGRUP, { views: [{ state: 'frozen', ySplit: AGRUP_LINHA0 - 1 }] })
  ws.columns = [
    { width: 40 },
    { width: 18 },
    { width: 16 },
    { width: 18 },
    { width: 18 },
    { width: 10 },
    { width: 44 }
  ]
  ws.mergeCells('A1:G1')
  ws.getCell('A1').value = 'Agrupamentos — calculado a partir da aba "Orçamento" (não edite)'
  estiloTexto(ws.getCell('A1'), { bold: true, size: 12 })
  // linha 2: rótulos · linha 3: valores
  const resumo: Array<[string, string, string]> = [
    ['Venda total', `SUM('${ABA}'!F2:F${ultimaOrc})`, '#,##0.00'],
    ['Agrupado', `SUM(${ABA_CALC}!E2:E${ultimaCalc})`, '#,##0.00'],
    ['% agrupado', 'IF(A3>0,B3/A3,0)', '0.0%'],
    [
      'Sem agrupamento',
      `SUMIFS('${ABA}'!F2:F${ultimaOrc},'${ABA}'!G2:G${ultimaOrc},"")`,
      '#,##0.00'
    ],
    ['Saldo de rateio', 'A3-B3-D3', '#,##0.00']
  ]
  resumo.forEach(([rotulo, formula, numFmt], i) => {
    const col = String.fromCharCode(65 + i)
    const l = ws.getCell(`${col}2`)
    l.value = rotulo
    estiloTexto(l, { bold: true, size: 9 })
    const v = ws.getCell(`${col}3`)
    v.value = { formula } as ExcelJS.CellFormulaValue
    v.numFmt = numFmt
    v.font = { bold: true }
  })

  const hdr = [
    'Serviço',
    'Unidade',
    'Quantidade',
    'Valor unitário',
    'Valor total',
    'Receitas',
    'Aviso'
  ]
  hdr.forEach((h, i) => {
    const c = ws.getCell(AGRUP_LINHA0 - 1, i + 1)
    c.value = h
    estiloHeader(c)
  })
  const A = `${ABA_CALC}!$A$2:$A$${ultimaCalc}`
  const G = `${ABA_CALC}!$G$2:$G$${ultimaCalc}`
  const J = `${ABA_CALC}!$J$2:$J$${ultimaCalc}`
  const K = `${ABA_CALC}!$K$2:$K$${ultimaCalc}`
  for (let j = 1; j <= AGRUP_MAX; j++) {
    const r = AGRUP_LINHA0 + j - 1
    const set = (col: string, formula: string, numFmt?: string): void => {
      const c = ws.getCell(`${col}${r}`)
      c.value = { formula } as ExcelJS.CellFormulaValue
      if (numFmt) c.numFmt = numFmt
    }
    // quantidade manual (colunas T/U da aba Orçamento) prevalece sobre o "compõe"
    const nManual = `COUNTIFS(${ABA_CALC}!$A:$A,A${r},${ABA_CALC}!$J:$J,">0")`
    const posManual = `MATCH(1,INDEX((${A}=A${r})*ISNUMBER(${J}),0),0)`
    set('A', `IFERROR(INDEX(${ABA_CALC}!$A:$A,MATCH(${j},${ABA_CALC}!$H:$H,0)),"")`)
    set(
      'B',
      `IF(A${r}="","",IF(${nManual}>0,INDEX(${K},${posManual}),IFERROR(INDEX(${G},MATCH(1,INDEX((${A}=A${r})*(${G}<>""),0),0)),"vb")))`
    )
    set(
      'C',
      `IF(A${r}="","",IF(${nManual}>0,INDEX(${J},${posManual}),IF(SUMIFS(${ABA_CALC}!$F:$F,${ABA_CALC}!$A:$A,A${r})=0,1,SUMIFS(${ABA_CALC}!$F:$F,${ABA_CALC}!$A:$A,A${r}))))`,
      '#,##0.00##'
    )
    set('E', `IF(A${r}="","",SUMIFS(${ABA_CALC}!$E:$E,${ABA_CALC}!$A:$A,A${r}))`, '#,##0.00')
    set('D', `IF(OR(A${r}="",N(C${r})=0),"",E${r}/C${r})`, '#,##0.00')
    set('F', `IF(A${r}="","",COUNTIFS(${ABA_CALC}!$A:$A,A${r}))`, '0')
    set(
      'G',
      `IF(A${r}="","",IF(${nManual}>0,IF(COUNTIFS(${ABA_CALC}!$A:$A,A${r},${ABA_CALC}!$J:$J,">0",${ABA_CALC}!$J:$J,"<>"&C${r})>0,"quantidades manuais diferentes nas receitas","quantidade manual"),IF(SUMIFS(${ABA_CALC}!$F:$F,${ABA_CALC}!$A:$A,A${r})=0,"sem receita que compõe a quantidade (entra como 1 vb)","")))`
    )
  }
  void ws.protect('', { selectLockedCells: true, selectUnlockedCells: true })

  // formatação condicional do "Alocado" na aba Orçamento
  const orc = wb.getWorksheet(ABA)
  if (orc) {
    orc.addConditionalFormatting({
      ref: `I2:I${ultimaOrc}`,
      rules: [
        {
          type: 'expression',
          priority: 1,
          formulae: [`AND(ISNUMBER(I2),I2>=0.9999)`],
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFDCFCE7' } } }
        },
        {
          type: 'expression',
          priority: 2,
          formulae: [`AND(ISNUMBER(I2),I2>0,I2<0.9999)`],
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFEF3C7' } } }
        },
        {
          type: 'expression',
          priority: 3,
          formulae: [`AND(ISNUMBER(I2),I2=0)`],
          style: { font: { color: { argb: 'FF9CA3AF' } } }
        }
      ]
    })
  }
}

export function gerarModeloOrcamento(ctx: TemplateCtx): Promise<Blob> {
  return buildTemplateWorkbook(ORCAMENTO_SPEC, ctx)
}

/** Exporta o orçamento atual (planilha de venda + serviços + rateios) no formato do modelo. */
export function exportarOrcamentoModelo(
  ctx: TemplateCtx,
  itens: Array<
    Pick<
      ItemOrcamentario,
      'id' | 'codigo' | 'descricao' | 'tipo' | 'unidade' | 'quantidade' | 'venda_unitaria'
    >
  >,
  servicos: Array<
    Pick<
      ItemOrcamentario,
      'id' | 'descricao' | 'qtd_ref_modo' | 'quantidade_referencia' | 'unidade_referencia'
    >
  >,
  alocacoes: ItemAlocacao[]
): { blob: Promise<Blob>; truncadas: string[]; manuaisSemLinha: string[] } {
  const nome = new Map(servicos.map((s) => [s.id, s.descricao]))
  const porReceita = new Map<string, ItemAlocacao[]>()
  for (const a of alocacoes) {
    const arr = porReceita.get(a.receita_id) ?? []
    arr.push(a)
    porReceita.set(a.receita_id, arr)
  }
  const truncadas: string[] = []
  const usadasPor = new Map<string, ItemAlocacao[]>()
  for (const i of itens) {
    const al = (porReceita.get(i.id) ?? []).slice().sort((a, b) => b.fracao - a.fracao)
    if (al.length === 0) continue
    if (al.length > N_SERV) truncadas.push(i.codigo)
    usadasPor.set(i.id, al.slice(0, N_SERV))
  }

  // Quantidade manual: vai numa receita em que o serviço é o 1º destino
  // (a ordem dos destinos não muda o rateio — as partes acompanham).
  const manualNaLinha = new Map<string, (typeof servicos)[number]>()
  const manuaisSemLinha: string[] = []
  for (const s of servicos) {
    if (s.qtd_ref_modo !== 'manual') continue
    let alvo: string | null = null
    for (const [receitaId, us] of usadasPor) {
      if (manualNaLinha.has(receitaId)) continue
      const idx = us.findIndex((a) => a.grupo_id === s.id)
      if (idx < 0) continue
      if (idx === 0 || alvo === null) alvo = receitaId
      if (idx === 0) break
    }
    if (!alvo) {
      manuaisSemLinha.push(s.descricao)
      continue
    }
    const us = usadasPor.get(alvo)!
    const idx = us.findIndex((a) => a.grupo_id === s.id)
    if (idx > 0) us.unshift(...us.splice(idx, 1))
    manualNaLinha.set(alvo, s)
  }

  const linhas = itens.map((i) => {
    const row: Record<string, unknown> = {
      codigo: i.codigo,
      descricao: i.descricao,
      unidade: i.tipo === 'receita' ? i.unidade : null,
      quantidade: i.tipo === 'receita' ? Number(i.quantidade ?? 0) : null,
      preco: i.tipo === 'receita' ? Number(i.venda_unitaria ?? 0) : null
    }
    const usadas = usadasPor.get(i.id)
    if (!usadas) return row
    const manual = manualNaLinha.get(i.id)
    if (manual) {
      row.qtd_servico = Number(manual.quantidade_referencia ?? 0)
      row.unid_servico = manual.unidade_referencia ?? 'vb'
    }
    row.compoe = usadas.some((a) => a.compoe_qtd) ? 'Sim' : 'Não'
    const crit = usadas[0].criterio
    const simples =
      usadas.length === 1 && crit === 'percentual' && Number(usadas[0].valor) >= 99.9999
    usadas.forEach((a, idx) => {
      const n = idx + 1
      row[n === 1 ? 'servico' : `servico${n}`] = nome.get(a.grupo_id) ?? ''
      if (!simples && crit !== 'venda') row[`parte${n}`] = a.valor === null ? null : Number(a.valor)
    })
    if (!simples) row.rateio = RATEIO_LABEL[crit]
    return row
  })
  return {
    blob: buildTemplateWorkbook(ORCAMENTO_SPEC, ctx, { dados: { [ABA]: linhas } }),
    truncadas,
    manuaisSemLinha
  }
}

export interface OrcamentoContexto {
  itens: Pick<ItemOrcamentario, 'codigo' | 'tipo' | 'descricao'>[]
  /** Mantido por compatibilidade (o modelo v4 não usa composições). */
  servicos?: Servico[]
}

const CODIGO_RE = /^[0-9]+(\.[0-9]+)*$/
const chave = (s: string): string => s.trim().toLowerCase()

export function parseOrcamento(
  wb: ExcelJS.Workbook,
  contexto: OrcamentoContexto
): ParseResult<OrcamentoLinha> {
  const spec = ORCAMENTO_SPEC.sheets[0]
  const parsed = parseSheet<Record<string, unknown>>(getSheet(wb, spec.name), spec)
  const existentes = new Map(contexto.itens.map((i) => [i.codigo, i]))
  const noArquivo = new Map<string, number>()
  const errosGerais: RowError[] = [...parsed.errosGerais]

  const rows: ParsedRow<OrcamentoLinha>[] = parsed.rows.map((pr) => {
    const d = pr.data
    const codigo = String(d.codigo ?? '').trim()
    const unidade = (d.unidade as string | null) ?? null
    const quantidade = (d.quantidade as number | null) ?? null
    const preco = (d.preco as number | null) ?? null
    const compoe = d.compoe === 'S'
    const rateio = (d.rateio as CriterioRateio | null) ?? null
    const erros = [...pr.erros]
    const avisos = [...pr.avisos]
    const base = { sheet: spec.name, row: pr.row }

    const tipo: OrcamentoLinha['tipo'] = unidade || quantidade != null ? 'receita' : 'etapa'
    if (tipo === 'receita') {
      if (!unidade)
        erros.push({
          ...base,
          col: 'Unidade',
          code: 'CAMPO_OBRIGATORIO',
          msg: 'Unidade obrigatória quando há quantidade.',
          nivel: 'erro'
        })
      if (quantidade == null || quantidade <= 0)
        erros.push({
          ...base,
          col: 'Quantidade',
          code: 'CAMPO_OBRIGATORIO',
          msg: 'Quantidade deve ser > 0.',
          nivel: 'erro'
        })
      if (preco == null)
        erros.push({
          ...base,
          col: 'Preço unitário de venda',
          code: 'CAMPO_OBRIGATORIO',
          msg: 'Preço de venda obrigatório para itens com quantidade.',
          nivel: 'erro'
        })
    }
    if (codigo && !CODIGO_RE.test(codigo))
      erros.push({
        ...base,
        col: 'Código',
        code: 'CODIGO_INVALIDO',
        msg: `Código "${codigo}" inválido (só números e pontos).`,
        nivel: 'erro'
      })
    const dup = noArquivo.get(codigo)
    if (dup)
      erros.push({
        ...base,
        col: 'Código',
        code: 'CODIGO_DUPLICADO_NO_ARQUIVO',
        msg: `Código ${codigo} repetido na linha ${dup}.`,
        nivel: 'erro'
      })
    else noArquivo.set(codigo, pr.row)

    // destinos (serviço + partes)
    const destinos: DestinoLinha[] = []
    for (let i = 1; i <= N_SERV; i++) {
      const s = String(d[i === 1 ? 'servico' : `servico${i}`] ?? '').trim()
      const p = (d[`parte${i}`] as number | null) ?? null
      if (!s) {
        if (p != null)
          erros.push({
            ...base,
            col: `Parte ${i}`,
            code: 'PARTE_SEM_SERVICO',
            msg: `Parte ${i} preenchida sem serviço.`,
            nivel: 'erro'
          })
        continue
      }
      destinos.push({ servico: s, valor: p })
    }
    if (destinos.length > 0 && tipo === 'etapa')
      erros.push({
        ...base,
        col: 'Serviço',
        code: 'SERVICO_EM_ETAPA',
        msg: 'Só receitas entram em serviços (esta linha é uma etapa).',
        nivel: 'erro'
      })
    if (compoe && destinos.length === 0)
      erros.push({
        ...base,
        col: 'Compõe a quantidade',
        code: 'COMPOE_SEM_SERVICO',
        msg: '"Compõe a quantidade" sem serviço.',
        nivel: 'erro'
      })
    const qtdServico = (d.qtd_servico as number | null) ?? null
    const unidServico = String(d.unid_servico ?? '').trim() || null
    if (qtdServico != null) {
      if (destinos.length === 0)
        erros.push({
          ...base,
          col: 'Qtd. manual do serviço',
          code: 'MANUAL_SEM_SERVICO',
          msg: 'Quantidade manual sem serviço na coluna "Serviço".',
          nivel: 'erro'
        })
      if (qtdServico <= 0)
        erros.push({
          ...base,
          col: 'Qtd. manual do serviço',
          code: 'NUMERO_INVALIDO',
          msg: 'Quantidade manual do serviço deve ser > 0.',
          nivel: 'erro'
        })
      if (!unidServico)
        erros.push({
          ...base,
          col: 'Unidade do serviço',
          code: 'CAMPO_OBRIGATORIO',
          msg: 'Informe a unidade da quantidade manual do serviço.',
          nivel: 'erro'
        })
    } else if (unidServico)
      erros.push({
        ...base,
        col: 'Qtd. manual do serviço',
        code: 'CAMPO_OBRIGATORIO',
        msg: 'Unidade do serviço sem quantidade manual.',
        nivel: 'erro'
      })
    const nomes = destinos.map((x) => chave(x.servico))
    if (new Set(nomes).size !== nomes.length)
      erros.push({
        ...base,
        col: 'Serviço',
        code: 'SERVICO_REPETIDO',
        msg: 'O mesmo serviço aparece duas vezes nesta linha.',
        nivel: 'erro'
      })

    let criterio: CriterioRateio = 'percentual'
    let fracoes: Array<number | null> = []
    if (destinos.length === 1) {
      if (rateio === 'percentual' && destinos[0].valor != null) {
        const v = destinos[0].valor
        if (v <= 0 || v > 100)
          erros.push({
            ...base,
            col: 'Parte 1',
            code: 'NUMERO_INVALIDO',
            msg: 'Percentual deve estar entre 0 e 100.',
            nivel: 'erro'
          })
        else if (v < 100)
          avisos.push({
            ...base,
            col: 'Parte 1',
            code: 'SALDO',
            msg: `Só ${v}% alocado — fica saldo de ${100 - v}%.`,
            nivel: 'aviso'
          })
        fracoes = [v / 100]
      } else {
        destinos[0] = { ...destinos[0], valor: 100 }
        fracoes = [1]
      }
    } else if (destinos.length > 1) {
      if (!rateio) {
        erros.push({
          ...base,
          col: 'Rateio por',
          code: 'RATEIO_SEM_CRITERIO',
          msg: 'Receita com mais de um serviço: informe "Rateio por" (%, Peso ou Venda).',
          nivel: 'erro'
        })
      } else {
        criterio = rateio
        if (rateio === 'venda') {
          fracoes = destinos.map(() => null)
          destinos.forEach((x) => (x.valor = null))
        } else {
          if (destinos.some((x) => x.valor == null || x.valor <= 0))
            erros.push({
              ...base,
              col: 'Parte 1',
              code: 'PARTE_FALTANDO',
              msg: `Rateio por ${RATEIO_LABEL[rateio]}: informe a parte de cada serviço.`,
              nivel: 'erro'
            })
          const tot = destinos.reduce((a, x) => a + (x.valor ?? 0), 0)
          if (rateio === 'percentual') {
            if (tot > 100.0001)
              erros.push({
                ...base,
                col: 'Parte 1',
                code: 'RATEIO_ACIMA',
                msg: `Rateio soma ${tot}% (acima de 100%).`,
                nivel: 'erro'
              })
            else if (tot < 99.9999)
              avisos.push({
                ...base,
                col: 'Parte 1',
                code: 'SALDO',
                msg: `Rateio soma ${tot}% — fica saldo de ${(100 - tot).toFixed(2)}%.`,
                nivel: 'aviso'
              })
            fracoes = destinos.map((x) => (x.valor ?? 0) / 100)
          } else {
            fracoes = destinos.map((x) => (tot > 0 ? (x.valor ?? 0) / tot : 0))
          }
        }
      }
    }

    const pai = parentCodigo(codigo)
    if (
      pai &&
      !existentes.has(pai) &&
      !parsed.rows.some((o) => String(o.data.codigo ?? '').trim() === pai)
    )
      avisos.push({
        ...base,
        col: 'Código',
        code: 'PAI_AUSENTE',
        msg: `Item pai ${pai} não existe — este item entra na raiz.`,
        nivel: 'aviso'
      })

    const existente = existentes.get(codigo)
    return {
      sheet: spec.name,
      row: pr.row,
      data: {
        row: pr.row,
        codigo,
        descricao: String(d.descricao ?? '').trim(),
        unidade: tipo === 'etapa' ? null : unidade,
        quantidade: tipo === 'etapa' ? null : quantidade,
        venda_unitaria: tipo === 'etapa' ? null : preco,
        tipo,
        destinos: tipo === 'etapa' ? [] : destinos,
        criterio,
        compoe_qtd: compoe,
        fracoes,
        qtd_servico: tipo === 'etapa' ? null : qtdServico,
        unid_servico: tipo === 'etapa' ? null : unidServico
      },
      acao: erros.length > 0 ? 'erro' : existente ? 'atualizar' : 'criar',
      motivo: existente ? `já existe (${existente.tipo}): ${existente.descricao}` : undefined,
      erros,
      avisos
    }
  })

  // Serviços: quantidade manual / sem receita que compõe / unidades diferentes
  const porServico = new Map<
    string,
    {
      nome: string
      compoe: Set<string>
      rows: ParsedRow<OrcamentoLinha>[]
      manual: { qtd: number; unid: string; row: number } | null
    }
  >()
  for (const r of rows) {
    r.data.destinos.forEach((dst, idx) => {
      const k = chave(dst.servico)
      const e = porServico.get(k) ?? {
        nome: dst.servico.trim(),
        compoe: new Set<string>(),
        rows: [],
        manual: null
      }
      e.rows.push(r)
      if (r.data.compoe_qtd && r.data.unidade) e.compoe.add(r.data.unidade.trim().toLowerCase())
      if (idx === 0 && r.data.qtd_servico != null && r.data.unid_servico && r.acao !== 'erro') {
        if (!e.manual) e.manual = { qtd: r.data.qtd_servico, unid: r.data.unid_servico, row: r.row }
        else if (
          Math.abs(e.manual.qtd - r.data.qtd_servico) > 1e-9 ||
          chave(e.manual.unid) !== chave(r.data.unid_servico)
        ) {
          r.erros.push({
            sheet: spec.name,
            row: r.row,
            col: 'Qtd. manual do serviço',
            code: 'MANUAL_DIVERGENTE',
            msg: `Serviço "${e.nome}": quantidade manual diferente da linha ${e.manual.row} (${e.manual.qtd} ${e.manual.unid}).`,
            nivel: 'erro'
          })
          r.acao = 'erro'
        }
      }
      porServico.set(k, e)
    })
  }
  for (const e of porServico.values()) {
    if (e.manual) {
      if (e.compoe.size > 0)
        errosGerais.push({
          sheet: spec.name,
          row: e.manual.row,
          code: 'MANUAL_PREVALECE',
          msg: `Serviço "${e.nome}": tem quantidade manual (${e.manual.qtd} ${e.manual.unid}) — ela prevalece sobre as receitas com "Compõe = Sim".`,
          nivel: 'aviso'
        })
    } else if (e.compoe.size === 0)
      errosGerais.push({
        sheet: spec.name,
        row: e.rows[0].row,
        code: 'SERVICO_SEM_QTD',
        msg: `Serviço "${e.nome}" não tem receita com "Compõe = Sim" nem quantidade manual: entra como 1 vb.`,
        nivel: 'aviso'
      })
    else if (e.compoe.size > 1)
      errosGerais.push({
        sheet: spec.name,
        row: e.rows[0].row,
        code: 'UNIDADES_DIFERENTES',
        msg: `Serviço "${e.nome}": receitas que compõem a quantidade têm unidades diferentes (${[...e.compoe].join(', ')}) — a soma não converte unidades.`,
        nivel: 'aviso'
      })
  }

  rows.sort((a, b) => compareCodigo(a.data.codigo, b.data.codigo))
  return { rows, errosGerais, resumo: resumoDe(rows) }
}

export interface OrcamentoPayload {
  itens: Array<Record<string, unknown>>
  alocacoes: Array<Record<string, unknown>>
  servicos: Array<Record<string, unknown>>
}

/** Itens + alocações + quantidades manuais (formato da RPC importar_orcamento v4). */
export function orcamentoToPayload(rows: ParsedRow<OrcamentoLinha>[]): OrcamentoPayload {
  return {
    itens: rows.map((r) => ({
      row: r.data.row,
      codigo: r.data.codigo,
      descricao: r.data.descricao,
      unidade: r.data.unidade,
      quantidade: r.data.quantidade,
      venda_unitaria: r.data.venda_unitaria
    })),
    alocacoes: rows
      .filter((r) => r.data.destinos.length > 0)
      .map((r) => ({
        row: r.data.row,
        codigo: r.data.codigo,
        criterio: r.data.criterio,
        compoe: r.data.compoe_qtd,
        destinos: r.data.destinos.map((x) => ({ servico: x.servico.trim(), valor: x.valor }))
      })),
    servicos: [
      ...new Map(
        rows
          .filter(
            (r) => r.acao !== 'erro' && r.data.destinos.length > 0 && r.data.qtd_servico != null
          )
          .map((r) => [
            chave(r.data.destinos[0].servico),
            {
              servico: r.data.destinos[0].servico.trim(),
              quantidade: r.data.qtd_servico,
              unidade: r.data.unid_servico
            }
          ])
      ).values()
    ]
  }
}

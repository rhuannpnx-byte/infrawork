import type ExcelJS from 'exceljs'
import type { Encarregado, LancamentoInput } from '@/types/acompanhamento'
import type { ItemLancavel } from '@/features/acompanhamento/hooks/lancamento'
import {
  localPorNome,
  resolverLocalProducao,
  type TrechoLocal
} from '@/features/acompanhamento/lib/local-producao'
import { estacaFinalTexto, estacaInicialTexto } from '@/features/planejamento/lib/trecho'
import type { ParseResult, ParsedRow, TemplateCtx, TemplateSpec } from '../types'
import { resumoDe } from '../types'
import { buildTemplateWorkbook } from '../template-builder'
import { cellText, getSheet, normalizeTxt, parseSheet, rawValue } from '../parse-sheet'

export interface ProducaoLinha {
  row: number
  data: string
  codigo_item: string
  item_orcamentario_id: string | null
  equipe_nome: string | null
  equipe_id: string | null
  encarregado_nome: string | null
  encarregado_id: string | null
  quantidade: number
  frente: string | null
  /** local (eixo/área) como escrito na planilha e o resolvido (controle por estaca) */
  local_nome: string | null
  trecho_id: string | null
  posicao_inicio_m: number | null
  posicao_fim_m: number | null
  estaca_inicial: string | null
  estaca_final: string | null
  obs: string | null
}

export const PRODUCAO_SPEC: TemplateSpec = {
  fileName: 'modelo-producao.xlsx',
  titulo: 'Modelo de importação — Produção (lançamentos diários)',
  versao: 'producao v2',
  sheets: [
    {
      name: 'Produção',
      columns: [
        {
          key: 'data',
          header: 'Data',
          required: true,
          tipo: 'text',
          width: 12,
          help: 'Data do lançamento (dd/mm/aaaa ou célula de data do Excel).'
        },
        {
          key: 'codigo_item',
          header: 'Código do item',
          required: true,
          tipo: 'code',
          width: 14,
          help: 'Código do item da planilha orçamentária (aba "Itens" lista os códigos válidos).'
        },
        {
          key: 'equipe',
          header: 'Equipe',
          tipo: 'text',
          width: 22,
          help: 'Nome exato da equipe (Planejamento → Equipes). Opcional.'
        },
        {
          key: 'encarregado',
          header: 'Encarregado',
          tipo: 'text',
          width: 22,
          help: 'Nome do encarregado. Novos nomes podem ser criados na importação.'
        },
        {
          key: 'quantidade',
          header: 'Quantidade',
          required: true,
          tipo: 'number',
          min: 0,
          width: 12,
          numFmt: '#,##0.00##',
          help: 'Quantidade executada, na unidade do item.'
        },
        {
          key: 'frente',
          header: 'Frente',
          tipo: 'text',
          width: 18,
          help: 'Frente/trecho de trabalho (texto livre).'
        },
        {
          key: 'local',
          header: 'Local',
          tipo: 'text',
          width: 24,
          aliases: ['trecho', 'eixo', 'area', 'local (eixo/area)'],
          help: 'Eixo ou área (Planejamento → Locais; a aba "Locais" lista os válidos). Com local, o realizado cai na tarefa do cronograma que cobre a faixa. Opcional.'
        },
        {
          key: 'estaca_inicial',
          header: 'Estaca inicial',
          tipo: 'text',
          width: 12,
          help: 'No padrão do eixo (ex.: 12+300, EST 125 ou o valor do marcador). Obrigatória quando o local é um eixo.'
        },
        {
          key: 'estaca_final',
          header: 'Estaca final',
          tipo: 'text',
          width: 12,
          help: 'No padrão do eixo. Obrigatória quando o local é um eixo; área não tem estacas.'
        },
        { key: 'obs', header: 'Obs', tipo: 'text', width: 36, help: 'Observações.' }
      ]
    },
    {
      name: 'Itens',
      blankRows: 0,
      columns: [
        {
          key: 'codigo',
          header: 'Código',
          tipo: 'code',
          width: 14,
          help: 'Referência: código do item (só leitura).'
        },
        { key: 'descricao', header: 'Descrição', tipo: 'text', width: 50, help: 'Referência.' },
        { key: 'unidade', header: 'Unidade', tipo: 'text', width: 10, help: 'Referência.' },
        {
          key: 'qtd_orcada',
          header: 'Qtd orçada',
          tipo: 'number',
          width: 14,
          numFmt: '#,##0.00##',
          help: 'Referência.'
        }
      ]
    },
    {
      name: 'Locais',
      blankRows: 0,
      columns: [
        {
          key: 'nome',
          header: 'Local',
          tipo: 'text',
          width: 30,
          help: 'Referência: nome do eixo/área.'
        },
        { key: 'tipo', header: 'Tipo', tipo: 'text', width: 10, help: 'Referência: eixo ou área.' },
        {
          key: 'estacas',
          header: 'Estacas válidas',
          tipo: 'text',
          width: 26,
          help: 'Referência: estaca inicial – final do eixo (área: sem estacas).'
        }
      ]
    }
  ],
  instrucoes: {
    passos: [
      'Preencha a aba "Produção", uma linha por lançamento (data × item × equipe).',
      'Consulte os códigos válidos na aba "Itens" (gerada com os itens com composição da obra).',
      'Para o controle por estaca, informe o Local (aba "Locais") e, num eixo, as estacas inicial e final.',
      'Importe em Acompanhamento → Lançar produção → Importar. A importação pode ser desfeita em seguida.'
    ],
    regras: [
      'Datas no futuro não são aceitas.',
      'Equipes são procuradas pelo nome exato (sem diferenciar acentos/maiúsculas).',
      'Encarregados que não existirem podem ser criados automaticamente.',
      'Local num eixo exige as estacas inicial e final dentro do eixo; área não tem estacas.',
      'Lançamentos importados ficam marcados com a origem "importação" e um lote, para desfazer.'
    ]
  },
  exemplo: [
    {
      sheet: 'Produção',
      rows: [
        {
          data: '03/11/2026',
          codigo_item: '01.01',
          equipe: 'Equipe A',
          encarregado: 'João',
          quantidade: 180,
          frente: 'Pista direita',
          local: 'Trecho 1',
          estaca_inicial: '12+300',
          estaca_final: '12+500',
          obs: 'Base'
        },
        {
          data: '04/11/2026',
          codigo_item: '01.01',
          equipe: 'Equipe A',
          encarregado: 'João',
          quantidade: 220,
          frente: 'Km 12+500'
        }
      ]
    }
  ]
}

/** Gera o modelo com a aba "Itens" preenchida com os itens lançáveis da obra. */
export async function gerarModeloProducao(
  ctx: TemplateCtx,
  itens: ItemLancavel[],
  trechos: TrechoLocal[] = []
): Promise<Blob> {
  const spec: TemplateSpec = {
    ...PRODUCAO_SPEC,
    exemplo: [
      ...PRODUCAO_SPEC.exemplo,
      {
        sheet: 'Itens',
        rows: itens.map((i) => ({
          codigo: i.codigo,
          descricao: i.descricao,
          unidade: i.unidade_referencia,
          qtd_orcada: i.quantidade_referencia
        }))
      },
      {
        sheet: 'Locais',
        rows: trechos.map((t) => ({
          nome: t.nome,
          tipo: t.tipo === 'area' ? 'área' : 'eixo',
          estacas: t.tipo === 'area' ? '—' : `${estacaInicialTexto(t)} – ${estacaFinalTexto(t)}`
        }))
      }
    ]
  }
  return buildTemplateWorkbook(spec, ctx)
}

function parseData(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date) {
    const p = (n: number): string => String(n).padStart(2, '0')
    return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}`
  }
  if (typeof v === 'number') {
    // serial Excel (dias desde 1899-12-30)
    const ms = Math.round((v - 25569) * 86400 * 1000)
    const d = new Date(ms)
    if (isNaN(d.getTime())) return null
    return d.toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s)
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return null
}

export interface ProducaoContexto {
  itens: ItemLancavel[]
  equipes: Array<{ id: string; nome: string }>
  encarregados: Encarregado[]
  /** locais da obra (controle por estaca) */
  trechos?: TrechoLocal[]
  hojeISO: string
}

export function parseProducao(
  wb: ExcelJS.Workbook,
  contexto: ProducaoContexto
): ParseResult<ProducaoLinha> {
  const spec = PRODUCAO_SPEC.sheets[0]
  const ws = getSheet(wb, spec.name)
  const parsed = parseSheet<Record<string, unknown>>(ws, spec)
  const itemPorCodigo = new Map(contexto.itens.map((i) => [i.codigo.trim(), i]))
  const equipePorNome = new Map(contexto.equipes.map((e) => [normalizeTxt(e.nome), e]))
  const encPorNome = new Map<string, Encarregado>()
  for (const e of contexto.encarregados) {
    encPorNome.set(normalizeTxt(e.nome), e)
    if (e.apelido) encPorNome.set(normalizeTxt(e.apelido), e)
  }

  const rows: ParsedRow<ProducaoLinha>[] = parsed.rows.map((pr) => {
    const erros = [...pr.erros]
    const avisos = [...pr.avisos]
    const base = { sheet: spec.name, row: pr.row }
    // data: relê a célula crua para aceitar Date/serial
    let dataISO: string | null = null
    if (ws && parsed.header) {
      const ci = parsed.header.colIdx['data']
      const cell = ci ? ws.getRow(pr.row).getCell(ci) : null
      dataISO = cell ? (parseData(rawValue(cell)) ?? parseData(cellText(cell))) : null
    }
    if (!dataISO)
      erros.push({
        ...base,
        col: 'Data',
        code: 'NUMERO_INVALIDO',
        msg: `Data inválida: "${String(pr.data.data ?? '')}".`,
        nivel: 'erro'
      })
    else if (dataISO > contexto.hojeISO)
      erros.push({
        ...base,
        col: 'Data',
        code: 'NUMERO_INVALIDO',
        msg: `Data no futuro: ${dataISO}.`,
        nivel: 'erro'
      })

    const codigo = String(pr.data.codigo_item ?? '').trim()
    const item = itemPorCodigo.get(codigo)
    if (!item)
      erros.push({
        ...base,
        col: 'Código do item',
        code: 'COMPOSICAO_NAO_ENCONTRADA',
        msg: `Item "${codigo}" não existe ou não aceita produção (precisa ter composição).`,
        nivel: 'erro'
      })

    const equipeNome = (pr.data.equipe as string | null)?.trim() || null
    const equipe = equipeNome ? equipePorNome.get(normalizeTxt(equipeNome)) : undefined
    if (equipeNome && !equipe)
      erros.push({
        ...base,
        col: 'Equipe',
        code: 'RECURSO_NAO_ENCONTRADO',
        msg: `Equipe "${equipeNome}" não existe (Planejamento → Equipes).`,
        nivel: 'erro'
      })

    const encNome = (pr.data.encarregado as string | null)?.trim() || null
    const enc = encNome ? encPorNome.get(normalizeTxt(encNome)) : undefined
    if (encNome && !enc)
      avisos.push({
        ...base,
        col: 'Encarregado',
        code: 'RECURSO_NAO_ENCONTRADO',
        msg: `Encarregado "${encNome}" será criado.`,
        nivel: 'aviso'
      })

    const localNome = String(pr.data.local ?? '').trim() || null
    const trecho = localNome ? localPorNome(contexto.trechos ?? [], localNome) : undefined
    let loc: {
      trecho_id: string | null
      posicao_inicio_m: number | null
      posicao_fim_m: number | null
    } = { trecho_id: null, posicao_inicio_m: null, posicao_fim_m: null }
    if (localNome && !trecho)
      erros.push({
        ...base,
        col: 'Local',
        code: 'RECURSO_NAO_ENCONTRADO',
        msg: `Local "${localNome}" não existe (Planejamento → Locais; veja a aba "Locais").`,
        nivel: 'erro'
      })
    else if (trecho) {
      const r = resolverLocalProducao(trecho, pr.data.estaca_inicial, pr.data.estaca_final)
      if (r.ok) loc = r
      else
        erros.push({
          ...base,
          col: 'Estaca inicial',
          code: 'NUMERO_INVALIDO',
          msg: r.erro,
          nivel: 'erro'
        })
      if (trecho.tipo === 'area' && (pr.data.estaca_inicial || pr.data.estaca_final))
        avisos.push({
          ...base,
          col: 'Estaca inicial',
          code: 'IGNORADO',
          msg: `"${trecho.nome}" é uma área (sem estacas): as estacas ficam só como texto.`,
          nivel: 'aviso'
        })
    }

    const quantidade = Number(pr.data.quantidade ?? 0)
    const data: ProducaoLinha = {
      row: pr.row,
      data: dataISO ?? '',
      codigo_item: codigo,
      item_orcamentario_id: item?.id ?? null,
      equipe_nome: equipeNome,
      equipe_id: equipe?.id ?? null,
      encarregado_nome: encNome,
      encarregado_id: enc?.id ?? null,
      quantidade,
      frente: (pr.data.frente as string | null) ?? null,
      local_nome: localNome,
      trecho_id: loc.trecho_id,
      posicao_inicio_m: loc.posicao_inicio_m,
      posicao_fim_m: loc.posicao_fim_m,
      estaca_inicial: (pr.data.estaca_inicial as string | null) ?? null,
      estaca_final: (pr.data.estaca_final as string | null) ?? null,
      obs: (pr.data.obs as string | null) ?? null
    }
    return {
      sheet: spec.name,
      row: pr.row,
      data,
      acao: erros.length > 0 ? 'erro' : 'criar',
      erros,
      avisos
    }
  })
  return { rows, errosGerais: parsed.errosGerais, resumo: resumoDe(rows) }
}

export function producaoToInputs(
  rows: ParsedRow<ProducaoLinha>[],
  obraId: string,
  encarregadoIdPorNome: Map<string, string>
): LancamentoInput[] {
  return rows.map((r) => ({
    obra_id: obraId,
    data: r.data.data,
    item_orcamentario_id: r.data.item_orcamentario_id!,
    equipe_id: r.data.equipe_id,
    encarregado_id:
      r.data.encarregado_id ??
      (r.data.encarregado_nome
        ? (encarregadoIdPorNome.get(normalizeTxt(r.data.encarregado_nome)) ?? null)
        : null),
    quantidade: r.data.quantidade,
    frente: r.data.frente,
    trecho_id: r.data.trecho_id,
    posicao_inicio_m: r.data.posicao_inicio_m,
    posicao_fim_m: r.data.posicao_fim_m,
    estaca_inicial: r.data.estaca_inicial,
    estaca_final: r.data.estaca_final,
    obs: r.data.obs
  }))
}

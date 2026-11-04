import type ExcelJS from 'exceljs'
import type { Recurso, RecursoGrupo } from '@/types/orcamento'
import type { ParseResult, ParsedRow, TemplateCtx, TemplateSpec } from '../types'
import { resumoDe } from '../types'
import { buildTemplateWorkbook } from '../template-builder'
import { getSheet, normalizeTxt, parseSheet } from '../parse-sheet'

export const GRUPO_RECURSO_ENUM = {
  values: ['Mão de obra', 'Equipamento', 'Combustível', 'Material', 'Administrativo'],
  map: {
    'mao de obra': 'MO',
    equipamento: 'MVE',
    combustivel: 'COMBUSTIVEL',
    material: 'MATERIAL',
    administrativo: 'ADM'
  },
  synonyms: {
    mo: 'MO',
    'mao-de-obra': 'MO',
    mve: 'MVE',
    eq: 'MVE',
    equip: 'MVE',
    equipamentos: 'MVE',
    comb: 'COMBUSTIVEL',
    combustiveis: 'COMBUSTIVEL',
    mat: 'MATERIAL',
    materiais: 'MATERIAL',
    adm: 'ADM',
    administracao: 'ADM'
  }
}

export interface RecursoLinha {
  row: number
  grupo: RecursoGrupo
  codigo: string | null
  nome: string
  unidade: string
  preco: number | null
  observacao: string | null
}

export const RECURSOS_SPEC: TemplateSpec = {
  fileName: 'modelo-recursos.xlsx',
  titulo: 'Modelo de importação — Recursos (insumos)',
  versao: 'recursos v1',
  sheets: [
    {
      name: 'Recursos',
      columns: [
        {
          key: 'grupo',
          header: 'Grupo',
          required: true,
          tipo: 'enum',
          enum: GRUPO_RECURSO_ENUM,
          width: 18,
          help: 'Tipo do insumo. Mão de obra e Equipamento são cobrados por hora; Material e Combustível por unidade consumida.'
        },
        {
          key: 'codigo',
          header: 'Código',
          tipo: 'code',
          width: 14,
          help: 'Código próprio ou de referência (ex.: SINAPI 88316). Opcional, mas único na obra. Se informado, é a chave de atualização.'
        },
        {
          key: 'nome',
          header: 'Nome',
          required: true,
          tipo: 'text',
          width: 44,
          help: 'Nome do recurso. Único dentro do grupo (sem diferenciar acentos/maiúsculas).'
        },
        {
          key: 'unidade',
          header: 'Unidade',
          required: true,
          tipo: 'text',
          width: 10,
          help: 'Unidade de compra/uso: h, L, m³, kg, t, un…'
        },
        {
          key: 'preco',
          header: 'Preço unitário',
          tipo: 'number',
          min: 0,
          width: 16,
          numFmt: '#,##0.00',
          help: 'R$ por unidade. Vira o preço vigente do recurso. Deixe em branco para manter o preço atual.'
        },
        {
          key: 'observacao',
          header: 'Observação',
          tipo: 'text',
          width: 36,
          help: 'Fonte da cotação, fornecedor, contexto.'
        }
      ]
    }
  ],
  instrucoes: {
    passos: [
      'Preencha a aba "Recursos", uma linha por insumo. Não altere a linha de cabeçalho.',
      'Use a lista suspensa da coluna Grupo. Mão de obra e Equipamento devem ter preço por HORA.',
      'Salve o arquivo e importe em Orçamento → Recursos → Importar modelo. Você verá uma prévia com o que será criado ou atualizado antes de confirmar.'
    ],
    regras: [
      'Digite números nas colunas numéricas (não texto). "1.500" como texto é ambíguo.',
      'Recursos já existentes (mesmo código, ou mesmo grupo + nome) são atualizados; o preço informado passa a ser o vigente.',
      'Reimportar o mesmo arquivo não cria duplicados.'
    ]
  },
  exemplo: [
    {
      sheet: 'Recursos',
      rows: [
        {
          grupo: 'Mão de obra',
          codigo: 'MO-001',
          nome: 'Servente',
          unidade: 'h',
          preco: 12.5,
          observacao: 'Convenção coletiva 2026'
        },
        {
          grupo: 'Mão de obra',
          codigo: 'MO-002',
          nome: 'Operador de rolo',
          unidade: 'h',
          preco: 18
        },
        {
          grupo: 'Equipamento',
          codigo: 'EQ-001',
          nome: 'Rolo compactador pé de carneiro',
          unidade: 'h',
          preco: 95,
          observacao: 'Locação com operador excluído'
        },
        {
          grupo: 'Equipamento',
          codigo: 'EQ-002',
          nome: 'Motoniveladora',
          unidade: 'h',
          preco: 180
        },
        { grupo: 'Combustível', codigo: 'CB-001', nome: 'Diesel S10', unidade: 'L', preco: 6.2 },
        { grupo: 'Material', codigo: 'MT-001', nome: 'Brita graduada', unidade: 'm³', preco: 85 },
        { grupo: 'Material', codigo: 'MT-002', nome: 'Água', unidade: 'm³', preco: 15 }
      ]
    }
  ]
}

export function gerarModeloRecursos(ctx: TemplateCtx): Promise<Blob> {
  return buildTemplateWorkbook(RECURSOS_SPEC, ctx)
}

export function parseRecursos(
  wb: ExcelJS.Workbook,
  contexto: { recursos: Recurso[] }
): ParseResult<RecursoLinha> {
  const spec = RECURSOS_SPEC.sheets[0]
  const parsed = parseSheet<RecursoLinha>(getSheet(wb, spec.name), spec)
  const porCodigo = new Map<string, Recurso>()
  const porNome = new Map<string, Recurso>()
  for (const r of contexto.recursos) {
    if (r.codigo) porCodigo.set(normalizeTxt(r.codigo), r)
    porNome.set(`${r.grupo}|${normalizeTxt(r.nome)}`, r)
  }
  const vistos = new Map<string, number>()

  const rows: ParsedRow<RecursoLinha>[] = parsed.rows.map((pr) => {
    const d = pr.data
    const data: RecursoLinha = {
      row: pr.row,
      grupo: (d.grupo as RecursoGrupo) ?? 'MATERIAL',
      codigo: (d.codigo as string | null) ?? null,
      nome: (d.nome as string) ?? '',
      unidade: (d.unidade as string) ?? '',
      preco: (d.preco as number | null) ?? null,
      observacao: (d.observacao as string | null) ?? null
    }
    const erros = [...pr.erros]
    const avisos = [...pr.avisos]
    const chave = data.codigo
      ? `c:${normalizeTxt(data.codigo)}`
      : `n:${data.grupo}|${normalizeTxt(data.nome)}`
    const dup = vistos.get(chave)
    if (dup) {
      erros.push({
        sheet: spec.name,
        row: pr.row,
        code: 'CODIGO_DUPLICADO_NO_ARQUIVO',
        msg: `Repetido na linha ${dup}.`,
        nivel: 'erro'
      })
    } else vistos.set(chave, pr.row)

    const existente =
      (data.codigo && porCodigo.get(normalizeTxt(data.codigo))) ||
      porNome.get(`${data.grupo}|${normalizeTxt(data.nome)}`)
    const acao = erros.length > 0 ? 'erro' : existente ? 'atualizar' : 'criar'
    return {
      sheet: spec.name,
      row: pr.row,
      data,
      acao,
      motivo: existente ? `já existe: ${existente.nome}` : undefined,
      erros,
      avisos
    }
  })
  return { rows, errosGerais: parsed.errosGerais, resumo: resumoDe(rows) }
}

export function recursosToPayload(rows: ParsedRow<RecursoLinha>[]): Record<string, unknown>[] {
  return rows.map((r) => ({ ...r.data }))
}

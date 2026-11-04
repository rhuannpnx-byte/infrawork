import type ExcelJS from 'exceljs'
import type { CpuItemGrupo, Recurso, RecursoGrupo, Servico } from '@/types/orcamento'
import type { ParseResult, ParsedRow, RowError, TemplateCtx, TemplateSpec } from '../types'
import { resumoDe } from '../types'
import { buildTemplateWorkbook } from '../template-builder'
import { compareCodigo, getSheet, normalizeTxt, parseSheet } from '../parse-sheet'

export const TIPO_ITEM_ENUM = {
  values: ['Equipamento', 'Mão de obra', 'Material', 'Combustível'],
  map: {
    equipamento: 'EQUIPAMENTO',
    'mao de obra': 'MO',
    material: 'MATERIAL',
    combustivel: 'COMBUSTIVEL'
  },
  synonyms: {
    eq: 'EQUIPAMENTO',
    mve: 'EQUIPAMENTO',
    mo: 'MO',
    mat: 'MATERIAL',
    comb: 'COMBUSTIVEL'
  }
}

const GRUPO_RECURSO_DO_ITEM: Record<CpuItemGrupo, RecursoGrupo> = {
  EQUIPAMENTO: 'MVE',
  MO: 'MO',
  MATERIAL: 'MATERIAL',
  COMBUSTIVEL: 'COMBUSTIVEL'
}

export interface ComposicaoItemLinha {
  row: number
  grupo: CpuItemGrupo
  recurso_ref: string
  recurso_id: string | null
  recurso_unidade: string | null
  preco: number | null
  quantidade: number | null
  horas_dia: number | null
  consumo_combustivel_lh: number | null
  indice_produtividade: number | null
  consumo_material_por_unid: number | null
}

export interface ComposicaoLinha {
  row: number
  codigo: string
  nome: string
  unidade: string | null
  producao_qtde: number | null
  observacao: string | null
  itens: ComposicaoItemLinha[]
}

export const COMPOSICOES_SPEC: TemplateSpec = {
  fileName: 'modelo-composicoes.xlsx',
  titulo: 'Modelo de importação — Composições (serviços + insumos)',
  versao: 'composicoes v1',
  sheets: [
    {
      name: 'Composições',
      columns: [
        {
          key: 'codigo',
          header: 'Código',
          required: true,
          tipo: 'code',
          width: 12,
          help: 'Hierárquico com pontos: 01, 01.02, 01.02.03. Linhas sem unidade são grupos (pastas); grupos ausentes são criados automaticamente.'
        },
        {
          key: 'nome',
          header: 'Nome do serviço',
          required: true,
          tipo: 'text',
          width: 44,
          help: 'Nome da composição/serviço.'
        },
        {
          key: 'unidade',
          header: 'Unidade',
          tipo: 'text',
          width: 10,
          help: 'Unidade produzida (m³, m², t, m, un). Vazio = grupo. "DIA" não é permitido.'
        },
        {
          key: 'producao_qtde',
          header: 'Produção por dia',
          tipo: 'number',
          min: 0,
          width: 16,
          numFmt: '#,##0.00##',
          help: 'Quantidade produzida por dia de trabalho, na unidade informada. Obrigatória para composições (não para grupos).'
        },
        {
          key: 'observacao',
          header: 'Observações',
          tipo: 'text',
          width: 36,
          help: 'Notas da composição.'
        }
      ]
    },
    {
      name: 'Insumos',
      columns: [
        {
          key: 'codigo_composicao',
          header: 'Código da composição',
          required: true,
          tipo: 'code',
          width: 18,
          help: 'Código da linha correspondente na aba Composições.'
        },
        {
          key: 'grupo',
          header: 'Tipo',
          required: true,
          tipo: 'enum',
          enum: TIPO_ITEM_ENUM,
          width: 14,
          help: 'Equipamento e Mão de obra: quantidade × horas/dia × preço/h. Material: consumo por unidade produzida × produção/dia × preço. Combustível: derivado dos equipamentos (ou litros/dia informados).'
        },
        {
          key: 'recurso',
          header: 'Recurso',
          required: true,
          tipo: 'text',
          width: 36,
          help: 'Código ou nome do recurso (aba Recursos). Se não existir, pode ser criado na importação.'
        },
        {
          key: 'recurso_unidade',
          header: 'Unidade do recurso',
          tipo: 'text',
          width: 12,
          help: 'Só usada ao criar um recurso que ainda não existe.'
        },
        {
          key: 'quantidade',
          header: 'Quantidade',
          tipo: 'number',
          min: 0,
          width: 12,
          numFmt: '#,##0.00##',
          help: 'Equipamento/Mão de obra: nº de unidades (default 1). Material: quantidade por dia quando "Consumo" está vazio. Combustível: litros/dia (vazio = calculado a partir dos equipamentos).'
        },
        {
          key: 'horas_dia',
          header: 'Horas por dia',
          tipo: 'number',
          min: 0,
          max: 24,
          width: 12,
          numFmt: '#,##0.00',
          help: 'Equipamento e Mão de obra. Default 8.'
        },
        {
          key: 'consumo',
          header: 'Consumo',
          tipo: 'number',
          min: 0,
          width: 12,
          numFmt: '#,##0.00##',
          help: 'Equipamento: litros de combustível por hora. Material: consumo por unidade produzida (ex.: 1,25 m³ de brita por m³ de base).'
        },
        {
          key: 'indice',
          header: 'Índice produtivo',
          tipo: 'number',
          min: 0,
          max: 100,
          width: 14,
          numFmt: '0.00',
          help: 'Equipamento: fração do tempo em operação (0 a 1; aceita 0 a 100). Default 1.'
        },
        {
          key: 'preco',
          header: 'Preço unitário',
          tipo: 'number',
          min: 0,
          width: 14,
          numFmt: '#,##0.00',
          help: 'Só usado ao criar um recurso novo (vira preço vigente).'
        }
      ]
    }
  ],
  instrucoes: {
    passos: [
      'Na aba "Composições", liste cada serviço (uma linha) com código, nome, unidade e produção por dia.',
      'Na aba "Insumos", liste os recursos de cada composição, repetindo o código da composição em cada linha.',
      'Importe em Orçamento → Composições → Importar modelo. A prévia mostra o que será criado/atualizado antes de confirmar.'
    ],
    regras: [
      'Códigos com pontos formam a hierarquia (01.02 fica dentro de 01). Grupos que não existirem são criados.',
      'Uma composição = um serviço + sua composição de custo vigente. Reimportar substitui os insumos da composição (ou cria nova versão, conforme a opção escolhida).',
      'Combustível é opcional: se houver equipamentos com consumo (L/h) e nenhuma linha de Combustível, você escolhe o combustível padrão na importação.',
      'Recursos informados por nome são procurados dentro do grupo correspondente (Equipamento → recursos do grupo Equipamento, etc.).'
    ]
  },
  exemplo: [
    {
      sheet: 'Composições',
      rows: [
        { codigo: '01', nome: 'PAVIMENTAÇÃO', unidade: null, producao_qtde: null },
        {
          codigo: '01.01',
          nome: 'Base de brita graduada',
          unidade: 'm³',
          producao_qtde: 200,
          observacao: 'Espalhamento, umedecimento e compactação'
        }
      ]
    },
    {
      sheet: 'Insumos',
      rows: [
        {
          codigo_composicao: '01.01',
          grupo: 'Equipamento',
          recurso: 'EQ-002',
          quantidade: 1,
          horas_dia: 8,
          consumo: 18,
          indice: 0.8
        },
        {
          codigo_composicao: '01.01',
          grupo: 'Equipamento',
          recurso: 'Rolo compactador pé de carneiro',
          quantidade: 1,
          horas_dia: 8,
          consumo: 12,
          indice: 1
        },
        {
          codigo_composicao: '01.01',
          grupo: 'Mão de obra',
          recurso: 'Servente',
          quantidade: 4,
          horas_dia: 8
        },
        {
          codigo_composicao: '01.01',
          grupo: 'Mão de obra',
          recurso: 'MO-002',
          quantidade: 1,
          horas_dia: 8
        },
        { codigo_composicao: '01.01', grupo: 'Material', recurso: 'Brita graduada', consumo: 1.25 },
        { codigo_composicao: '01.01', grupo: 'Material', recurso: 'MT-002', consumo: 0.1 },
        { codigo_composicao: '01.01', grupo: 'Combustível', recurso: 'Diesel S10' }
      ]
    }
  ]
}

export function gerarModeloComposicoes(ctx: TemplateCtx): Promise<Blob> {
  return buildTemplateWorkbook(COMPOSICOES_SPEC, ctx)
}

export interface ComposicoesContexto {
  recursos: Recurso[]
  servicos: Servico[]
}

const CODIGO_RE = /^[0-9]{1,3}(\.[0-9]{1,3})*$/

export function parseComposicoes(
  wb: ExcelJS.Workbook,
  contexto: ComposicoesContexto
): ParseResult<ComposicaoLinha> {
  const [specComp, specItens] = COMPOSICOES_SPEC.sheets
  const pc = parseSheet<Record<string, unknown>>(getSheet(wb, specComp.name), specComp)
  const pi = parseSheet<Record<string, unknown>>(getSheet(wb, specItens.name), specItens, {
    required: false
  })
  const errosGerais: RowError[] = [...pc.errosGerais, ...pi.errosGerais]

  const recPorCodigo = new Map<string, Recurso>()
  const recPorNome = new Map<string, Recurso>()
  for (const r of contexto.recursos) {
    if (r.codigo) recPorCodigo.set(normalizeTxt(r.codigo), r)
    recPorNome.set(`${r.grupo}|${normalizeTxt(r.nome)}`, r)
  }
  const servPorCodigo = new Map(contexto.servicos.map((s) => [s.codigo, s]))

  // composições
  const porCodigo = new Map<string, ParsedRow<ComposicaoLinha>>()
  const rows: ParsedRow<ComposicaoLinha>[] = []
  for (const pr of pc.rows) {
    const d = pr.data
    const codigo = String(d.codigo ?? '').trim()
    const data: ComposicaoLinha = {
      row: pr.row,
      codigo,
      nome: String(d.nome ?? '').trim(),
      unidade: (d.unidade as string | null) ?? null,
      producao_qtde: (d.producao_qtde as number | null) ?? null,
      observacao: (d.observacao as string | null) ?? null,
      itens: []
    }
    const erros = [...pr.erros]
    const avisos = [...pr.avisos]
    const base = { sheet: specComp.name, row: pr.row }
    if (codigo && !CODIGO_RE.test(codigo))
      erros.push({
        ...base,
        col: 'Código',
        code: 'CODIGO_INVALIDO',
        msg: `Código "${codigo}" inválido (use 01, 01.02, 01.02.03).`,
        nivel: 'erro'
      })
    if (porCodigo.has(codigo))
      erros.push({
        ...base,
        col: 'Código',
        code: 'CODIGO_DUPLICADO_NO_ARQUIVO',
        msg: `Código ${codigo} repetido na linha ${porCodigo.get(codigo)!.row}.`,
        nivel: 'erro'
      })
    const ehGrupo = !data.unidade
    if (!ehGrupo) {
      if (data.unidade && data.unidade.trim().toUpperCase() === 'DIA')
        erros.push({
          ...base,
          col: 'Unidade',
          code: 'UNIDADE_DIA_PROIBIDA',
          msg: 'Unidade "DIA" não é permitida.',
          nivel: 'erro'
        })
      if (data.producao_qtde == null || data.producao_qtde <= 0)
        erros.push({
          ...base,
          col: 'Produção por dia',
          code: 'CAMPO_OBRIGATORIO',
          msg: 'Produção por dia deve ser > 0 para composições.',
          nivel: 'erro'
        })
    }
    const existente = servPorCodigo.get(codigo)
    const prefixoPai = codigo.includes('.') ? codigo.slice(0, codigo.lastIndexOf('.')) : null
    if (
      prefixoPai &&
      !servPorCodigo.has(prefixoPai) &&
      !pc.rows.some((o) => String(o.data.codigo ?? '').trim() === prefixoPai)
    ) {
      avisos.push({
        ...base,
        col: 'Código',
        code: 'PAI_AUSENTE',
        msg: `Grupo ${prefixoPai} não existe — será criado como "Grupo ${prefixoPai}".`,
        nivel: 'aviso'
      })
    }
    const row: ParsedRow<ComposicaoLinha> = {
      sheet: specComp.name,
      row: pr.row,
      data,
      acao: erros.length > 0 ? 'erro' : existente ? 'atualizar' : 'criar',
      motivo: existente ? `já existe: ${existente.nome}` : ehGrupo ? 'grupo' : undefined,
      erros,
      avisos
    }
    rows.push(row)
    if (codigo) porCodigo.set(codigo, row)
  }

  // insumos
  for (const pr of pi.rows) {
    const d = pr.data
    const codComp = String(d.codigo_composicao ?? '').trim()
    const comp = porCodigo.get(codComp)
    const base = { sheet: specItens.name, row: pr.row }
    if (!comp) {
      errosGerais.push({
        ...base,
        col: 'Código da composição',
        code: 'COMPOSICAO_NAO_ENCONTRADA',
        msg: `Linha ${pr.row} de Insumos: composição "${codComp}" não está na aba Composições.`,
        nivel: 'erro'
      })
      continue
    }
    if (!comp.data.unidade) {
      comp.erros.push({
        ...base,
        code: 'PAI_SERVICO_GRUPO_SO_RECEITA',
        msg: `Insumo na linha ${pr.row} aponta para um grupo (sem unidade).`,
        nivel: 'erro'
      })
      comp.acao = 'erro'
      continue
    }
    const grupo = (d.grupo as CpuItemGrupo | null) ?? null
    const ref = String(d.recurso ?? '').trim()
    const item: ComposicaoItemLinha = {
      row: pr.row,
      grupo: grupo ?? 'MATERIAL',
      recurso_ref: ref,
      recurso_id: null,
      recurso_unidade: (d.recurso_unidade as string | null) ?? null,
      preco: (d.preco as number | null) ?? null,
      quantidade: (d.quantidade as number | null) ?? null,
      horas_dia: (d.horas_dia as number | null) ?? null,
      consumo_combustivel_lh:
        grupo === 'EQUIPAMENTO' ? ((d.consumo as number | null) ?? null) : null,
      indice_produtividade: (d.indice as number | null) ?? null,
      consumo_material_por_unid:
        grupo === 'MATERIAL' ? ((d.consumo as number | null) ?? null) : null
    }
    for (const e of pr.erros) comp.erros.push(e)
    for (const a of pr.avisos) comp.avisos.push(a)
    if (grupo && ref) {
      const grupoRec = GRUPO_RECURSO_DO_ITEM[grupo]
      const rec =
        recPorCodigo.get(normalizeTxt(ref)) ?? recPorNome.get(`${grupoRec}|${normalizeTxt(ref)}`)
      if (rec) {
        item.recurso_id = rec.id
        if (rec.grupo !== grupoRec) {
          comp.erros.push({
            ...base,
            col: 'Recurso',
            code: 'RECURSO_GRUPO_INCOMPATIVEL',
            msg: `Linha ${pr.row}: recurso "${rec.nome}" é do grupo ${rec.grupo}, incompatível com ${grupo}.`,
            nivel: 'erro'
          })
        }
      } else {
        comp.avisos.push({
          ...base,
          col: 'Recurso',
          code: 'RECURSO_NAO_ENCONTRADO',
          msg: `Linha ${pr.row}: recurso "${ref}" não existe — será criado (${item.recurso_unidade ?? 'un'}${item.preco != null ? `, R$ ${item.preco}` : ', sem preço'}) se a opção estiver marcada.`,
          nivel: 'aviso'
        })
      }
    }
    comp.data.itens.push(item)
    if (comp.erros.length > 0) comp.acao = 'erro'
  }

  // avisos de combustível ausente
  for (const row of rows) {
    if (!row.data.unidade) continue
    const temComb = row.data.itens.some((i) => i.grupo === 'COMBUSTIVEL')
    const somaLh = row.data.itens
      .filter((i) => i.grupo === 'EQUIPAMENTO')
      .reduce((a, i) => a + (i.consumo_combustivel_lh ?? 0) * (i.quantidade ?? 1), 0)
    if (!temComb && somaLh > 0) {
      row.avisos.push({
        sheet: specComp.name,
        row: row.row,
        code: 'COMBUSTIVEL_AUSENTE',
        msg: 'Equipamentos com consumo, mas sem linha de combustível — escolha o combustível padrão na importação.',
        nivel: 'aviso'
      })
    }
  }

  rows.sort((a, b) => compareCodigo(a.data.codigo, b.data.codigo))
  return { rows, errosGerais, resumo: resumoDe(rows) }
}

export function composicoesToPayload(
  rows: ParsedRow<ComposicaoLinha>[]
): Record<string, unknown>[] {
  return rows.map((r) => ({
    row: r.data.row,
    codigo: r.data.codigo,
    nome: r.data.nome,
    unidade: r.data.unidade,
    producao_qtde: r.data.producao_qtde,
    observacao: r.data.observacao,
    itens: r.data.itens.map((i) => ({
      row: i.row,
      grupo: i.grupo,
      recurso_id: i.recurso_id,
      recurso_ref: i.recurso_ref,
      recurso_unidade: i.recurso_unidade,
      preco: i.preco,
      quantidade: i.quantidade,
      horas_dia: i.horas_dia,
      consumo_combustivel_lh: i.consumo_combustivel_lh,
      indice_produtividade: i.indice_produtividade,
      consumo_material_por_unid: i.consumo_material_por_unid
    }))
  }))
}

import { z } from 'zod'
import { rpc } from '../contexto'
import { CONFIRMAR, exigir, ferramenta, pedirConfirmacao } from '../ferramenta'
import { contar, eq, gravar, ler } from '../lib/banco'
import { ARQUIVO, abrirPlanilha, blobBase64, resumoParse, validas } from '../lib/planilha'
import {
  gerarModeloRecursos,
  parseRecursos,
  recursosToPayload
} from '@/lib/xlsx/templates/recursos'
import {
  composicoesToPayload,
  gerarModeloComposicoes,
  parseComposicoes
} from '@/lib/xlsx/templates/composicoes'

const OBRA = z.string().uuid().describe('id da obra')
const GRUPO_RECURSO = z.enum(['MO', 'MVE', 'COMBUSTIVEL', 'MATERIAL', 'ADM'])
const GRUPO_ITEM = z.enum(['EQUIPAMENTO', 'COMBUSTIVEL', 'MO', 'MATERIAL'])

async function ctxTemplate(obraId: string) {
  const [o] = await ler<{ codigo: string; nome: string; empresa_id: string }>('obras', {
    colunas: 'codigo, nome, empresa_id',
    filtros: [eq('id', obraId)]
  })
  if (!o) throw new Error('Obra não encontrada ou sem acesso.')
  const [e] = await ler<{ nome: string }>('empresas', {
    colunas: 'nome',
    filtros: [eq('id', o.empresa_id)]
  })
  return { empresaNome: e?.nome ?? '', obraCodigo: o.codigo, obraNome: o.nome }
}

export const recursos = ferramenta({
  nome: 'recursos',
  titulo: 'Recursos (insumos) e preços',
  descricao:
    'Insumos da obra: mão de obra (MO), máquinas e veículos (MVE), combustível, material e administração (ADM), ' +
    'com histórico de preços. acao: listar | criar | editar | excluir | preco (novo preço; vigente por padrão) | ' +
    'vigente (marca um preço existente como vigente) | modelo (xlsx do modelo) | importar (xlsx ou JSON; sem ' +
    'confirmar=true devolve a prévia). Mudar preço recalcula composições e orçamento no banco.',
  entrada: {
    acao: z.enum([
      'listar',
      'criar',
      'editar',
      'excluir',
      'preco',
      'vigente',
      'modelo',
      'importar'
    ]),
    obra_id: OBRA.optional(),
    id: z.string().uuid().optional().describe('recurso'),
    grupo: GRUPO_RECURSO.optional(),
    codigo: z.string().nullable().optional(),
    nome: z.string().optional(),
    unidade: z.string().optional(),
    ativo: z.boolean().optional(),
    fonte: z.string().nullable().optional(),
    observacao: z.string().nullable().optional(),
    custo_unitario: z.number().optional().describe('preço / preço inicial'),
    vigencia_inicio: z.string().optional().describe('AAAA-MM-DD (padrão hoje)'),
    marcar_vigente: z.boolean().optional(),
    preco_id: z.string().uuid().optional(),
    busca: z.string().optional().describe('listar: filtra por nome (ilike)'),
    ...ARQUIVO,
    linhas: z
      .array(z.record(z.string(), z.any()))
      .optional()
      .describe('importar em JSON: [{row, grupo, codigo, nome, unidade, preco, observacao}]'),
    atualizar_existentes: z.boolean().optional(),
    atualizar_precos: z.boolean().optional(),
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: {
    tabelas: ['recurso', 'recurso_preco'],
    rpcs: ['set_recurso_preco_vigente', 'importar_recursos']
  },
  async executar(a) {
    const hoje = new Date().toISOString().slice(0, 10)
    switch (a.acao) {
      case 'listar':
        return ler('vw_recurso_com_preco', {
          filtros: [
            eq('obra_id', exigir(a.obra_id, 'obra_id', a.acao)),
            ...(a.busca ? [{ coluna: 'nome', op: 'ilike' as const, valor: `%${a.busca}%` }] : [])
          ],
          ordem: [{ coluna: 'grupo' }, { coluna: 'nome' }]
        })
      case 'criar': {
        const [r] = await gravar<{ id: string }>('recurso', 'insert', {
          obra_id: exigir(a.obra_id, 'obra_id', a.acao),
          codigo: a.codigo?.trim() || null,
          grupo: exigir(a.grupo, 'grupo', a.acao),
          nome: exigir(a.nome, 'nome', a.acao).trim(),
          unidade: exigir(a.unidade, 'unidade', a.acao).trim(),
          fonte: a.fonte?.trim() || null,
          observacao: a.observacao?.trim() || null
        })
        if (a.custo_unitario != null)
          await gravar('recurso_preco', 'insert', {
            recurso_id: r!.id,
            custo_unitario: a.custo_unitario,
            vigencia_inicio: a.vigencia_inicio ?? hoje,
            is_vigente: true
          })
        return r
      }
      case 'editar': {
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
        for (const k of [
          'codigo',
          'grupo',
          'nome',
          'unidade',
          'ativo',
          'fonte',
          'observacao'
        ] as const)
          if (a[k] !== undefined) patch[k] = a[k]
        return (await gravar('recurso', 'update', patch, [eq('id', exigir(a.id, 'id', a.acao))]))[0]
      }
      case 'excluir': {
        const id = exigir(a.id, 'id', a.acao)
        const usos = await contar('cpu_item', [eq('recurso_id', id)])
        const pedido = pedirConfirmacao(a.confirmar, 'excluir recurso', {
          id,
          usado_em_itens_de_composicao: usos
        })
        if (pedido) return pedido
        await gravar('recurso', 'delete', null, [eq('id', id)])
        return { excluido: id }
      }
      case 'preco': {
        const [p] = await gravar<{ id: string }>('recurso_preco', 'insert', {
          recurso_id: exigir(a.id, 'id', a.acao),
          custo_unitario: exigir(a.custo_unitario, 'custo_unitario', a.acao),
          vigencia_inicio: a.vigencia_inicio ?? hoje,
          observacao: a.observacao ?? null
        })
        if (a.marcar_vigente !== false) await rpc('set_recurso_preco_vigente', { _preco_id: p!.id })
        return p
      }
      case 'vigente':
        await rpc('set_recurso_preco_vigente', {
          _preco_id: exigir(a.preco_id, 'preco_id', a.acao)
        })
        return { ok: true }
      case 'modelo':
        return {
          arquivo: 'modelo-recursos.xlsx',
          base64: await blobBase64(
            gerarModeloRecursos(await ctxTemplate(exigir(a.obra_id, 'obra_id', a.acao)))
          )
        }
      case 'importar': {
        const obra = exigir(a.obra_id, 'obra_id', a.acao)
        const wb = await abrirPlanilha(a)
        let linhas: Record<string, unknown>[]
        let previa: unknown
        if (wb) {
          const existentes = await ler('recurso', { filtros: [eq('obra_id', obra)] })
          const p = parseRecursos(wb, { recursos: existentes as never })
          previa = resumoParse(p)
          linhas = recursosToPayload(validas(p))
        } else {
          linhas = exigir(a.linhas, 'linhas (ou arquivo_base64/url)', a.acao)
          previa = { linhas: linhas.length }
        }
        const pedido = pedirConfirmacao(a.confirmar, 'importar recursos', previa)
        if (pedido) return pedido
        return rpc('importar_recursos', {
          _obra_id: obra,
          _linhas: linhas,
          _opcoes: {
            atualizar_existentes: a.atualizar_existentes ?? false,
            atualizar_precos: a.atualizar_precos ?? false,
            tudo_ou_nada: true
          }
        })
      }
    }
  }
})

const ITEM_COMPOSICAO = z.object({
  grupo: GRUPO_ITEM,
  recurso_id: z.string().uuid(),
  quantidade: z.number().nullable(),
  horas_dia: z.number().nullable().optional(),
  consumo_combustivel_lh: z.number().nullable().optional(),
  indice_produtividade: z.number().nullable().optional(),
  consumo_material_por_unid: z.number().nullable().optional()
})

export const composicoes = ferramenta({
  nome: 'composicoes',
  titulo: 'Composições de custo (CPU)',
  descricao:
    'Composições (serviço de custo + CPU vigente + insumos). acao: listar | detalhe (insumos e custo ao vivo) | ' +
    'salvar (cria ou edita uma composição em JSON: codigo, nome, unidade, producao_qtde por dia e itens ' +
    '[{grupo EQUIPAMENTO|COMBUSTIVEL|MO|MATERIAL, recurso_id, quantidade, horas_dia, consumo_combustivel_lh, ' +
    'indice_produtividade, consumo_material_por_unid}]; modo: erro=nova, substituir_itens=editar, ' +
    'nova_versao) | excluir | modelo | importar (xlsx ou JSON no formato da RPC importar_composicoes; prévia ' +
    'sem confirmar). Para ligar a composição ao orçamento use agrupadores.editar com servico_id.',
  entrada: {
    acao: z.enum(['listar', 'detalhe', 'salvar', 'excluir', 'modelo', 'importar']),
    obra_id: OBRA.optional(),
    servico_id: z.string().uuid().optional().describe('composição (tabela servico)'),
    codigo: z.string().optional(),
    nome: z.string().optional(),
    unidade: z.string().optional(),
    producao_qtde: z
      .number()
      .optional()
      .describe('produção da equipe por dia, na unidade do serviço'),
    observacao: z.string().nullable().optional(),
    itens: z.array(ITEM_COMPOSICAO).optional(),
    modo: z.enum(['erro', 'substituir_itens', 'nova_versao']).optional(),
    ...ARQUIVO,
    composicoes: z.array(z.record(z.string(), z.any())).optional(),
    modo_existente: z.enum(['substituir_itens', 'nova_versao', 'pular', 'erro']).optional(),
    criar_recursos_faltantes: z.boolean().optional(),
    busca: z.string().optional(),
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: { tabelas: ['servico', 'cpu', 'cpu_item'], rpcs: ['importar_composicoes'] },
  async executar(a) {
    switch (a.acao) {
      case 'listar': {
        const obra = exigir(a.obra_id, 'obra_id', a.acao)
        const [servs, vivos] = await Promise.all([
          ler<{ id: string }>('servico', {
            colunas:
              'id, codigo, nome, unidade, parent_id, nivel, ativo, producao_diaria_qtde, producao_diaria_unidade',
            filtros: [
              eq('obra_id', obra),
              ...(a.busca ? [{ coluna: 'nome', op: 'ilike' as const, valor: `%${a.busca}%` }] : [])
            ],
            ordem: [{ coluna: 'codigo' }]
          }),
          ler<{ servico_id: string }>('vw_servico_vivo', {
            colunas:
              'servico_id, cpu_id, custo_unit, producao_diaria_qtde, producao_diaria_unidade, modo',
            filtros: [eq('obra_id', obra)]
          })
        ])
        const viva = new Map(vivos.map((v) => [v.servico_id, v]))
        return servs.map((x) => ({ ...x, custo_ao_vivo: viva.get(x.id) ?? null }))
      }
      case 'detalhe': {
        const id = exigir(a.servico_id, 'servico_id', a.acao)
        const [servico] = await ler('servico', { filtros: [eq('id', id)] })
        const [vivo] = await ler('vw_servico_vivo', { filtros: [eq('servico_id', id)] })
        const cpus = await ler<{ id: string }>('cpu', {
          filtros: [eq('servico_id', id)],
          ordem: [{ coluna: 'versao', asc: false }]
        })
        const itens = cpus.length
          ? await ler('cpu_item', {
              filtros: [{ coluna: 'cpu_id', op: 'in', valor: cpus.map((c) => c.id) }],
              ordem: [{ coluna: 'ordem' }]
            })
          : []
        const links = await ler('servico_cpu_link', { filtros: [eq('servico_id', id)] })
        return { servico, custo_ao_vivo: vivo ?? null, cpus, itens, links }
      }
      case 'salvar': {
        const r = await rpc<{ ok: boolean; resultados: unknown[]; erros: { msg: string }[] }>(
          'importar_composicoes',
          {
            _obra_id: exigir(a.obra_id, 'obra_id', a.acao),
            _composicoes: [
              {
                row: 1,
                codigo: exigir(a.codigo, 'codigo', a.acao),
                nome: exigir(a.nome, 'nome', a.acao),
                unidade: exigir(a.unidade, 'unidade', a.acao),
                producao_qtde: exigir(a.producao_qtde, 'producao_qtde', a.acao),
                observacao: a.observacao ?? null,
                itens: exigir(a.itens, 'itens', a.acao).map((i, n) => ({
                  row: n + 1,
                  horas_dia: null,
                  consumo_combustivel_lh: null,
                  indice_produtividade: null,
                  consumo_material_por_unid: null,
                  ...i
                }))
              }
            ],
            _opcoes: {
              modo_existente: a.modo ?? 'erro',
              criar_recursos_faltantes: false,
              combustivel_padrao_recurso_id: null,
              tudo_ou_nada: true
            }
          }
        )
        if (!r.ok) throw new Error(r.erros?.[0]?.msg ?? 'Falha ao salvar a composição.')
        return r.resultados[0]
      }
      case 'excluir': {
        const id = exigir(a.servico_id, 'servico_id', a.acao)
        const usos = await contar('item_orcamentario', [eq('servico_id', id)])
        const pedido = pedirConfirmacao(a.confirmar, 'excluir composição', {
          id,
          servicos_do_orcamento_que_usam: usos
        })
        if (pedido) return pedido
        await gravar('servico', 'delete', null, [eq('id', id)])
        return { excluido: id }
      }
      case 'modelo':
        return {
          arquivo: 'modelo-composicoes.xlsx',
          base64: await blobBase64(
            gerarModeloComposicoes(await ctxTemplate(exigir(a.obra_id, 'obra_id', a.acao)))
          )
        }
      case 'importar': {
        const obra = exigir(a.obra_id, 'obra_id', a.acao)
        const wb = await abrirPlanilha(a)
        let lista: Record<string, unknown>[]
        let previa: unknown
        if (wb) {
          const [rec, serv] = await Promise.all([
            ler('recurso', { filtros: [eq('obra_id', obra)] }),
            ler('servico', { filtros: [eq('obra_id', obra)] })
          ])
          const p = parseComposicoes(wb, { recursos: rec as never, servicos: serv as never })
          previa = resumoParse(p)
          lista = composicoesToPayload(validas(p))
        } else {
          lista = exigir(a.composicoes, 'composicoes (ou arquivo_base64/url)', a.acao)
          previa = { composicoes: lista.length }
        }
        const pedido = pedirConfirmacao(a.confirmar, 'importar composições', previa)
        if (pedido) return pedido
        return rpc('importar_composicoes', {
          _obra_id: obra,
          _composicoes: lista,
          _opcoes: {
            modo_existente: a.modo_existente ?? 'substituir_itens',
            criar_recursos_faltantes: a.criar_recursos_faltantes ?? true,
            combustivel_padrao_recurso_id: null,
            tudo_ou_nada: true
          }
        })
      }
    }
  }
})

export const servicosCatalogo = ferramenta({
  nome: 'servicos_catalogo',
  titulo: 'Catálogo de serviços de custo e vínculos de CPU',
  descricao:
    'Ajustes finos do catálogo de composições: editar um serviço de custo (nome, unidade, produção diária, ' +
    'ativo), juntar várias CPUs num serviço (servico_cpu_link com fator e operação dividir|multiplicar), editar ' +
    'itens de uma CPU ou publicar uma versão. acao: editar_servico | criar_servico (com cpu_id cria já vinculado ' +
    'à CPU, numa transação) | vincular_cpu | ' +
    'editar_vinculo | remover_vinculo | item_cpu (cria/edita insumo de uma CPU) | remover_item_cpu | ' +
    'publicar_cpu (marca a versão como vigente).',
  entrada: {
    acao: z.enum([
      'editar_servico',
      'criar_servico',
      'vincular_cpu',
      'editar_vinculo',
      'remover_vinculo',
      'item_cpu',
      'remover_item_cpu',
      'publicar_cpu'
    ]),
    obra_id: OBRA.optional(),
    servico_id: z.string().uuid().optional(),
    codigo: z.string().optional(),
    nome: z.string().optional(),
    unidade: z.string().nullable().optional(),
    ativo: z.boolean().optional(),
    producao_diaria_qtde: z.number().nullable().optional(),
    producao_diaria_unidade: z.string().nullable().optional(),
    cpu_id: z.string().uuid().optional(),
    vinculo_id: z.string().uuid().optional(),
    fator: z.number().optional(),
    operacao: z.enum(['dividir', 'multiplicar']).optional(),
    item_id: z.string().uuid().optional(),
    item: ITEM_COMPOSICAO.extend({ ordem: z.number().int().optional() }).optional()
  },
  cobre: {
    tabelas: ['servico', 'servico_cpu_link', 'cpu', 'cpu_item'],
    rpcs: ['servico_criar_da_cpu']
  },
  async executar(a) {
    switch (a.acao) {
      case 'criar_servico':
        // com cpu_id: cria, vincula e torna o serviço dono da CPU numa transação
        if (a.cpu_id)
          return {
            id: await rpc<string>('servico_criar_da_cpu', {
              _obra_id: exigir(a.obra_id, 'obra_id', a.acao),
              _codigo: exigir(a.codigo, 'codigo', a.acao).trim(),
              _nome: exigir(a.nome, 'nome', a.acao).trim(),
              _unidade: a.unidade ?? null,
              _cpu_id: a.cpu_id,
              _fator: a.fator ?? 1,
              _operacao: a.operacao ?? 'dividir'
            })
          }
        return (
          await gravar('servico', 'insert', {
            obra_id: exigir(a.obra_id, 'obra_id', a.acao),
            codigo: exigir(a.codigo, 'codigo', a.acao).trim(),
            nome: exigir(a.nome, 'nome', a.acao).trim(),
            unidade: a.unidade ?? null
          })
        )[0]
      case 'editar_servico': {
        const patch: Record<string, unknown> = {}
        for (const k of [
          'codigo',
          'nome',
          'unidade',
          'ativo',
          'producao_diaria_qtde',
          'producao_diaria_unidade'
        ] as const)
          if (a[k] !== undefined) patch[k] = a[k]
        return (
          await gravar('servico', 'update', patch, [
            eq('id', exigir(a.servico_id, 'servico_id', a.acao))
          ])
        )[0]
      }
      case 'vincular_cpu':
        return (
          await gravar('servico_cpu_link', 'insert', {
            servico_id: exigir(a.servico_id, 'servico_id', a.acao),
            cpu_id: exigir(a.cpu_id, 'cpu_id', a.acao),
            fator: a.fator ?? 1,
            operacao: a.operacao ?? 'dividir'
          })
        )[0]
      case 'editar_vinculo': {
        const patch: Record<string, unknown> = {}
        if (a.fator !== undefined) patch.fator = a.fator
        if (a.operacao !== undefined) patch.operacao = a.operacao
        return (
          await gravar('servico_cpu_link', 'update', patch, [
            eq('id', exigir(a.vinculo_id, 'vinculo_id', a.acao))
          ])
        )[0]
      }
      case 'remover_vinculo':
        await gravar('servico_cpu_link', 'delete', null, [
          eq('id', exigir(a.vinculo_id, 'vinculo_id', a.acao))
        ])
        return { ok: true }
      case 'item_cpu': {
        const i = exigir(a.item, 'item', a.acao)
        const payload = {
          grupo: i.grupo,
          recurso_id: i.recurso_id,
          quantidade: i.quantidade,
          horas_dia: i.horas_dia ?? null,
          consumo_combustivel_lh: i.consumo_combustivel_lh ?? null,
          indice_produtividade: i.indice_produtividade ?? 1,
          consumo_material_por_unid: i.consumo_material_por_unid ?? null,
          ordem: i.ordem ?? 0
        }
        if (a.item_id)
          return (await gravar('cpu_item', 'update', payload, [eq('id', a.item_id)]))[0]
        return (
          await gravar('cpu_item', 'insert', {
            ...payload,
            cpu_id: exigir(a.cpu_id, 'cpu_id', a.acao)
          })
        )[0]
      }
      case 'remover_item_cpu':
        await gravar('cpu_item', 'delete', null, [eq('id', exigir(a.item_id, 'item_id', a.acao))])
        return { ok: true }
      case 'publicar_cpu':
        await gravar('cpu', 'update', { is_vigente: true }, [
          eq('id', exigir(a.cpu_id, 'cpu_id', a.acao))
        ])
        return { ok: true }
    }
  }
})

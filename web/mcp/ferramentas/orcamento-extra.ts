import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ctxAtual, rpc } from '../contexto'
import { CONFIRMAR, exigir, ferramenta, pedirConfirmacao } from '../ferramenta'
import { eq, gravar, ler } from '../lib/banco'

const OBRA = z.string().uuid().describe('id da obra')

function patchDe<T extends Record<string, unknown>>(a: T, campos: (keyof T)[]) {
  const p: Record<string, unknown> = {}
  for (const k of campos) if (a[k] !== undefined) p[k as string] = a[k]
  return p
}

export const indiretos = ferramenta({
  nome: 'indiretos',
  titulo: 'Custos indiretos',
  descricao:
    'Itens de custo indireto da obra (mobilização, desmobilização, administração local, outros). Regra do ' +
    'InfraWork: custo = valor unitário × períodos (não há modo verba). acao: listar | salvar (cria sem id, edita ' +
    'com id) | excluir. Para o indireto entrar no orçamento, crie um agrupador com indireto_id.',
  entrada: {
    acao: z.enum(['listar', 'salvar', 'excluir']),
    obra_id: OBRA.optional(),
    id: z.string().uuid().optional(),
    parent_id: z.string().uuid().nullable().optional(),
    codigo: z.string().optional(),
    descricao: z.string().optional(),
    tipo: z.enum(['mobilizacao', 'desmob', 'admin_local', 'outros']).optional(),
    valor_total: z.number().optional(),
    distribuicao_perc: z.number().optional(),
    ordem: z.number().int().optional(),
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: { tabelas: ['indireto_item'] },
  async executar(a) {
    if (a.acao === 'listar')
      return ler('indireto_item', {
        filtros: [eq('obra_id', exigir(a.obra_id, 'obra_id', a.acao))],
        ordem: [{ coluna: 'codigo' }]
      })
    if (a.acao === 'excluir') {
      const id = exigir(a.id, 'id', a.acao)
      const pedido = pedirConfirmacao(a.confirmar, 'excluir indireto', { id })
      if (pedido) return pedido
      await gravar('indireto_item', 'delete', null, [eq('id', id)])
      return { excluido: id }
    }
    if (a.id)
      return (
        await gravar(
          'indireto_item',
          'update',
          patchDe(a, [
            'parent_id',
            'codigo',
            'descricao',
            'tipo',
            'valor_total',
            'distribuicao_perc',
            'ordem'
          ]),
          [eq('id', a.id)]
        )
      )[0]
    return (
      await gravar('indireto_item', 'insert', {
        obra_id: exigir(a.obra_id, 'obra_id', a.acao),
        parent_id: a.parent_id ?? null,
        codigo: exigir(a.codigo, 'codigo', a.acao).trim(),
        descricao: exigir(a.descricao, 'descricao', a.acao).trim(),
        tipo: exigir(a.tipo, 'tipo', a.acao),
        valor_total: exigir(a.valor_total, 'valor_total', a.acao),
        distribuicao_perc: a.distribuicao_perc ?? 1,
        ordem: a.ordem ?? 0
      })
    )[0]
  }
})

export const notasItem = ferramenta({
  nome: 'notas_item',
  titulo: 'Memória de cálculo, comentários e anexos de um item',
  descricao:
    'Documentação de um item do orçamento. acao: memoria (lê) | memoria_salvar (texto markdown e faixa de ' +
    'estacas) | memoria_excluir | comentarios | comentar | resolver (marca/desmarca comentário resolvido) | ' +
    'excluir_comentario | anexos (lista com links de 1 h) | anexar (arquivo em base64) | excluir_anexo.',
  entrada: {
    acao: z.enum([
      'memoria',
      'memoria_salvar',
      'memoria_excluir',
      'comentarios',
      'comentar',
      'resolver',
      'excluir_comentario',
      'anexos',
      'anexar',
      'excluir_anexo'
    ]),
    item_id: z.string().uuid().optional().describe('item do orçamento'),
    obra_id: OBRA.optional().describe('anexar: obra do item'),
    body_md: z.string().optional(),
    estaca_inicio: z.string().nullable().optional(),
    estaca_fim: z.string().nullable().optional(),
    texto: z.string().optional(),
    comentario_id: z.string().uuid().optional(),
    resolvido: z.boolean().optional(),
    anexo_id: z.string().uuid().optional(),
    nome_arquivo: z.string().optional(),
    mime: z.string().optional(),
    arquivo_base64: z.string().optional()
  },
  cobre: { tabelas: ['memoria_calculo_item', 'comentario_item', 'anexo'] },
  async executar(a) {
    const c = ctxAtual()
    const item = () => exigir(a.item_id, 'item_id', a.acao)
    switch (a.acao) {
      case 'memoria':
        return (await ler('memoria_calculo_item', { filtros: [eq('item_id', item())] }))[0] ?? null
      case 'memoria_salvar': {
        const corpo = {
          body_md: exigir(a.body_md, 'body_md', a.acao),
          estaca_inicio: a.estaca_inicio ?? null,
          estaca_fim: a.estaca_fim ?? null
        }
        const [ex] = await ler<{ id: string }>('memoria_calculo_item', {
          colunas: 'id',
          filtros: [eq('item_id', item())]
        })
        if (ex) return (await gravar('memoria_calculo_item', 'update', corpo, [eq('id', ex.id)]))[0]
        return (
          await gravar('memoria_calculo_item', 'insert', {
            ...corpo,
            item_id: item(),
            autor_id: c.perfil.id
          })
        )[0]
      }
      case 'memoria_excluir':
        await gravar('memoria_calculo_item', 'delete', null, [eq('item_id', item())])
        return { ok: true }
      case 'comentarios':
        return ler('comentario_item', {
          filtros: [eq('item_id', item())],
          ordem: [{ coluna: 'created_at' }]
        })
      case 'comentar':
        return (
          await gravar('comentario_item', 'insert', {
            item_id: item(),
            texto: exigir(a.texto, 'texto', a.acao).trim(),
            autor_id: c.perfil.id
          })
        )[0]
      case 'resolver': {
        const r = exigir(a.resolvido, 'resolvido', a.acao)
        return (
          await gravar(
            'comentario_item',
            'update',
            {
              resolvido: r,
              resolvido_por: r ? c.perfil.id : null,
              resolvido_em: r ? new Date().toISOString() : null
            },
            [eq('id', exigir(a.comentario_id, 'comentario_id', a.acao))]
          )
        )[0]
      }
      case 'excluir_comentario':
        await gravar('comentario_item', 'delete', null, [
          eq('id', exigir(a.comentario_id, 'comentario_id', a.acao))
        ])
        return { ok: true }
      case 'anexos': {
        const lista = await ler<{ storage_path: string }>('anexo', {
          filtros: [eq('escopo', 'item'), eq('escopo_id', item())]
        })
        return Promise.all(
          lista.map(async (x) => ({
            ...x,
            url:
              (await c.sb.storage.from('orcamento').createSignedUrl(x.storage_path, 3600)).data
                ?.signedUrl ?? null
          }))
        )
      }
      case 'anexar': {
        const obra = exigir(a.obra_id, 'obra_id', a.acao)
        const nome = exigir(a.nome_arquivo, 'nome_arquivo', a.acao)
        const bytes = Buffer.from(exigir(a.arquivo_base64, 'arquivo_base64', a.acao), 'base64')
        const path = `${obra}/item/${item()}/${randomUUID()}-${nome.replace(/[^\w.-]+/g, '_')}`
        const up = await c.sb.storage
          .from('orcamento')
          .upload(path, bytes, { contentType: a.mime ?? 'application/octet-stream' })
        if (up.error) throw new Error(up.error.message)
        try {
          return (
            await gravar('anexo', 'insert', {
              obra_id: obra,
              escopo: 'item',
              escopo_id: item(),
              nome,
              storage_path: path,
              mime: a.mime ?? null,
              tamanho_bytes: bytes.length,
              autor_id: c.perfil.id
            })
          )[0]
        } catch (e) {
          await c.sb.storage.from('orcamento').remove([path])
          throw e
        }
      }
      case 'excluir_anexo': {
        const id = exigir(a.anexo_id, 'anexo_id', a.acao)
        const [x] = await ler<{ storage_path: string }>('anexo', {
          colunas: 'storage_path',
          filtros: [eq('id', id)]
        })
        if (!x) throw new Error('Anexo não encontrado.')
        await gravar('anexo', 'delete', null, [eq('id', id)])
        await c.sb.storage.from('orcamento').remove([x.storage_path])
        return { ok: true }
      }
    }
  }
})

export const aditivos = ferramenta({
  nome: 'aditivos',
  titulo: 'Aditivos contratuais',
  descricao:
    'Aditivos do contrato: depois do 1º aditivo, a planilha de venda só muda por aditivo. acao: listar | criar ' +
    '(data, descrição) | editar | excluir (rascunho) | itens | salvar_item (tipo quantidade: receita_id + ' +
    'quantidade_nova; tipo novo: codigo, descricao, unidade, quantidade_nova, venda_unitaria e opcionalmente ' +
    'alocacao do novo item a serviços) | excluir_item | aplicar (efetiva no orçamento; a planilha inicial fica ' +
    'arquivada; supressão abaixo do executado é recusada).',
  entrada: {
    acao: z.enum([
      'listar',
      'criar',
      'editar',
      'excluir',
      'itens',
      'salvar_item',
      'excluir_item',
      'aplicar'
    ]),
    obra_id: OBRA.optional(),
    id: z.string().uuid().optional().describe('aditivo'),
    data: z.string().optional().describe('AAAA-MM-DD'),
    descricao: z.string().nullable().optional(),
    item_id: z.string().uuid().optional(),
    tipo: z.enum(['quantidade', 'novo']).optional(),
    receita_id: z.string().uuid().nullable().optional(),
    codigo: z.string().optional(),
    unidade: z.string().nullable().optional(),
    quantidade_antes: z.number().nullable().optional(),
    quantidade_nova: z.number().nullable().optional(),
    venda_unitaria: z.number().nullable().optional(),
    alocacao: z.record(z.string(), z.any()).nullable().optional(),
    ordem: z.number().int().optional(),
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: {
    // aplicar_aditivo arquiva a planilha inicial em orcamento_planilha_inicial
    tabelas: ['orcamento_aditivo', 'orcamento_aditivo_item', 'orcamento_planilha_inicial'],
    rpcs: ['aplicar_aditivo']
  },
  async executar(a) {
    const id = () => exigir(a.id, 'id', a.acao)
    switch (a.acao) {
      case 'listar':
        return ler('orcamento_aditivo', {
          filtros: [eq('obra_id', exigir(a.obra_id, 'obra_id', a.acao))],
          ordem: [{ coluna: 'data' }]
        })
      case 'criar':
        return (
          await gravar('orcamento_aditivo', 'insert', {
            obra_id: exigir(a.obra_id, 'obra_id', a.acao),
            data: exigir(a.data, 'data', a.acao),
            descricao: a.descricao?.trim() || null
          })
        )[0]
      case 'editar':
        return (
          await gravar('orcamento_aditivo', 'update', patchDe(a, ['data', 'descricao']), [
            eq('id', id())
          ])
        )[0]
      case 'excluir': {
        const pedido = pedirConfirmacao(a.confirmar, 'excluir aditivo', { id: id() })
        if (pedido) return pedido
        await gravar('orcamento_aditivo', 'delete', null, [eq('id', id())])
        return { excluido: id() }
      }
      case 'itens':
        return ler('orcamento_aditivo_item', {
          filtros: [eq('aditivo_id', id())],
          ordem: [{ coluna: 'ordem' }]
        })
      case 'salvar_item': {
        const corpo = patchDe(a, [
          'tipo',
          'receita_id',
          'codigo',
          'descricao',
          'unidade',
          'quantidade_antes',
          'quantidade_nova',
          'venda_unitaria',
          'alocacao',
          'ordem'
        ])
        if (a.item_id)
          return (await gravar('orcamento_aditivo_item', 'update', corpo, [eq('id', a.item_id)]))[0]
        exigir(a.tipo, 'tipo', a.acao)
        exigir(a.codigo, 'codigo', a.acao)
        return (await gravar('orcamento_aditivo_item', 'insert', { ...corpo, aditivo_id: id() }))[0]
      }
      case 'excluir_item':
        await gravar('orcamento_aditivo_item', 'delete', null, [
          eq('id', exigir(a.item_id, 'item_id', a.acao))
        ])
        return { ok: true }
      case 'aplicar': {
        const itens = await ler('orcamento_aditivo_item', { filtros: [eq('aditivo_id', id())] })
        const pedido = pedirConfirmacao(a.confirmar, 'aplicar aditivo (irreversível)', {
          aditivo: id(),
          itens: itens.length
        })
        if (pedido) return pedido
        return rpc('aplicar_aditivo', { _aditivo_id: id() })
      }
    }
  }
})

export const reajustes = ferramenta({
  nome: 'reajustes',
  titulo: 'Reajustes de preço e data-base',
  descricao:
    'Reajuste da venda por índices. acao: data_base (define a data-base do orçamento) | listar | criar (data, ' +
    'descrição; copiar_de traz grupos e classificação de outro reajuste) | editar | excluir | detalhe (grupos e ' +
    'receitas classificadas) | salvar_grupo (nome, ordem, indice_anterior, indice_atual) | excluir_grupo | ' +
    'classificar (receita_ids num grupo; grupo_id null retira) | aplicar. Regras: 12 meses depois da data-base ' +
    'e 12 meses entre reajustes; o preço novo vale a partir da data do reajuste. preco_em: preço de venda de ' +
    'uma receita numa data.',
  entrada: {
    acao: z.enum([
      'data_base',
      'listar',
      'criar',
      'editar',
      'excluir',
      'detalhe',
      'salvar_grupo',
      'excluir_grupo',
      'classificar',
      'aplicar',
      'preco_em'
    ]),
    obra_id: OBRA.optional(),
    id: z.string().uuid().optional().describe('reajuste'),
    receita_id: z.string().uuid().optional().describe('preco_em: receita'),
    data: z.string().optional().describe('AAAA-MM-DD'),
    descricao: z.string().nullable().optional(),
    copiar_de: z.string().uuid().nullable().optional(),
    grupo_id: z.string().uuid().nullable().optional(),
    nome: z.string().optional(),
    ordem: z.number().int().optional(),
    indice_anterior: z.number().optional(),
    indice_atual: z.number().optional(),
    receita_ids: z.array(z.string().uuid()).optional(),
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: {
    tabelas: ['orcamento_reajuste', 'orcamento_reajuste_grupo', 'orcamento_reajuste_item'],
    rpcs: ['definir_data_base', 'aplicar_reajuste', 'receita_preco_em', 'reajuste_criar']
  },
  async executar(a) {
    const id = () => exigir(a.id, 'id', a.acao)
    switch (a.acao) {
      case 'data_base':
        await rpc('definir_data_base', {
          _obra_id: exigir(a.obra_id, 'obra_id', a.acao),
          _data: exigir(a.data, 'data', a.acao)
        })
        return { ok: true }
      case 'listar':
        return ler('orcamento_reajuste', {
          filtros: [eq('obra_id', exigir(a.obra_id, 'obra_id', a.acao))],
          ordem: [{ coluna: 'data' }]
        })
      case 'criar':
        // rascunho + grupos e classificação copiados, numa transação
        return {
          id: await rpc<string>('reajuste_criar', {
            _obra_id: exigir(a.obra_id, 'obra_id', a.acao),
            _data: exigir(a.data, 'data', a.acao),
            _descricao: a.descricao ?? null,
            _copiar_de: a.copiar_de ?? null
          })
        }
      case 'editar':
        return (
          await gravar('orcamento_reajuste', 'update', patchDe(a, ['data', 'descricao']), [
            eq('id', id())
          ])
        )[0]
      case 'excluir': {
        const pedido = pedirConfirmacao(a.confirmar, 'excluir reajuste', { id: id() })
        if (pedido) return pedido
        await gravar('orcamento_reajuste', 'delete', null, [eq('id', id())])
        return { excluido: id() }
      }
      case 'detalhe': {
        const [grupos, itens] = await Promise.all([
          ler('orcamento_reajuste_grupo', {
            filtros: [eq('reajuste_id', id())],
            ordem: [{ coluna: 'ordem' }]
          }),
          ler('orcamento_reajuste_item', { filtros: [eq('reajuste_id', id())] })
        ])
        return { grupos, itens }
      }
      case 'salvar_grupo': {
        const corpo = patchDe(a, ['nome', 'ordem', 'indice_anterior', 'indice_atual'])
        if (a.grupo_id)
          return (
            await gravar('orcamento_reajuste_grupo', 'update', corpo, [eq('id', a.grupo_id)])
          )[0]
        return (
          await gravar('orcamento_reajuste_grupo', 'insert', { ...corpo, reajuste_id: id() })
        )[0]
      }
      case 'excluir_grupo':
        await gravar('orcamento_reajuste_grupo', 'delete', null, [
          eq('id', exigir(a.grupo_id, 'grupo_id', a.acao))
        ])
        return { ok: true }
      case 'classificar': {
        const ids = exigir(a.receita_ids, 'receita_ids', a.acao)
        if (a.grupo_id == null) {
          await gravar('orcamento_reajuste_item', 'delete', null, [
            eq('reajuste_id', id()),
            { coluna: 'receita_id', op: 'in', valor: ids }
          ])
          return { retiradas: ids.length }
        }
        await gravar(
          'orcamento_reajuste_item',
          'upsert',
          ids.map((receita_id) => ({ reajuste_id: id(), receita_id, grupo_id: a.grupo_id })),
          [],
          { onConflict: 'reajuste_id,receita_id' }
        )
        return { classificadas: ids.length }
      }
      case 'preco_em':
        return {
          preco: await rpc('receita_preco_em', {
            _receita_id: exigir(a.receita_id, 'receita_id', a.acao),
            _data: exigir(a.data, 'data', a.acao)
          })
        }
      case 'aplicar': {
        const pedido = pedirConfirmacao(a.confirmar, 'aplicar reajuste (irreversível)', {
          id: id()
        })
        if (pedido) return pedido
        return rpc('aplicar_reajuste', { _reajuste_id: id() })
      }
    }
  }
})

export const taxas = ferramenta({
  nome: 'taxas',
  titulo: 'Regimes de encargos e impostos',
  descricao:
    'Regimes de encargos/impostos da obra (ISS, PIS, COFINS, CSLL, IRPJ, CPRB, outros, em %). acao: listar | ' +
    'criar | editar | ativar (ativo true/false).',
  entrada: {
    acao: z.enum(['listar', 'criar', 'editar', 'ativar']),
    obra_id: OBRA.optional(),
    id: z.string().uuid().optional(),
    nome: z.string().optional(),
    iss_perc: z.number().optional(),
    pis_perc: z.number().optional(),
    cofins_perc: z.number().optional(),
    csll_perc: z.number().optional(),
    irpj_perc: z.number().optional(),
    cprb_perc: z.number().optional(),
    outros_perc: z.number().optional(),
    vigencia_inicio: z.string().nullable().optional(),
    ativo: z.boolean().optional()
  },
  cobre: { tabelas: ['encargos_sociais_regime'] },
  async executar(a) {
    const campos = [
      'nome',
      'iss_perc',
      'pis_perc',
      'cofins_perc',
      'csll_perc',
      'irpj_perc',
      'cprb_perc',
      'outros_perc',
      'vigencia_inicio'
    ] as const
    switch (a.acao) {
      case 'listar':
        return ler('encargos_sociais_regime', {
          filtros: [eq('obra_id', exigir(a.obra_id, 'obra_id', a.acao))]
        })
      case 'criar':
        return (
          await gravar('encargos_sociais_regime', 'insert', {
            obra_id: exigir(a.obra_id, 'obra_id', a.acao),
            iss_perc: 0,
            pis_perc: 0,
            cofins_perc: 0,
            csll_perc: 0,
            irpj_perc: 0,
            cprb_perc: 0,
            outros_perc: 0,
            ...patchDe(a, [...campos]),
            nome: exigir(a.nome, 'nome', a.acao).trim(),
            ativo: true
          })
        )[0]
      case 'editar':
        return (
          await gravar('encargos_sociais_regime', 'update', patchDe(a, [...campos]), [
            eq('id', exigir(a.id, 'id', a.acao))
          ])
        )[0]
      case 'ativar':
        return (
          await gravar(
            'encargos_sociais_regime',
            'update',
            { ativo: exigir(a.ativo, 'ativo', a.acao) },
            [eq('id', exigir(a.id, 'id', a.acao))]
          )
        )[0]
    }
  }
})

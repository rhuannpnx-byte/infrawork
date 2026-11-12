import { z } from 'zod'
import { ctxAtual, fn, rpc } from '../contexto'
import { CONFIRMAR, exigir, ferramenta, pedirConfirmacao } from '../ferramenta'
import { contar, eq, gravar, ler } from '../lib/banco'
import { geometriaDeCoordenadas, geometriaDeKml } from '../lib/geo'
import { recalcularEmEdicao } from './planejamento-extra'

const OBRA = z.string().uuid().describe('id da obra')
const PAPEL = z.enum(['god', 'adm', 'engenheiro', 'apoio', 'cliente', 'apontador'])

export const obras = ferramenta({
  nome: 'obras',
  titulo: 'Obras e empresas',
  descricao:
    'acao: listar | detalhe | prontidao (o que falta para a obra ter previsto e realizado: etapa, situação, resumo e ' +
    'itens pendentes) | criar (nome, codigo; cria o calendário padrão — os locais vêm em trechos.criar) | editar ' +
    '(nome, código, status, rodovia, trecho, extensão, data-base do orçamento, datas planejadas) | ativar ' +
    '(ativa true/false: some da seleção, nada é apagado) | excluir (apaga a obra e tudo dela) | criar_empresa ' +
    '(só god). Criar/excluir obra: god ou adm da empresa.',
  entrada: {
    acao: z.enum([
      'listar',
      'detalhe',
      'prontidao',
      'criar',
      'editar',
      'ativar',
      'excluir',
      'criar_empresa'
    ]),
    obra_id: OBRA.optional(),
    empresa_id: z.string().uuid().optional(),
    nome: z.string().optional(),
    codigo: z.string().optional(),
    status: z.string().optional(),
    rodovia: z.string().nullable().optional(),
    trecho: z.string().nullable().optional(),
    extensao_km: z.number().nullable().optional(),
    data_base_orcamento: z.string().nullable().optional(),
    data_inicio_planejada: z.string().nullable().optional(),
    data_fim_planejada: z.string().nullable().optional(),
    ativa: z.boolean().optional(),
    cnpj: z.string().optional(),
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: {
    tabelas: ['obras', 'empresas'],
    funcoes: ['create-obra', 'set-obra-ativa', 'delete-obra', 'create-empresa'],
    rpcs: ['excluir_obra', 'obra_prontidao']
  },
  async executar(a) {
    const obra = () => exigir(a.obra_id, 'obra_id', a.acao)
    switch (a.acao) {
      case 'prontidao':
        return rpc('obra_prontidao', { _obra_id: obra() })
      case 'listar':
        return ler('obras', { ordem: [{ coluna: 'codigo' }] })
      case 'detalhe': {
        const [o] = await ler('obras', { filtros: [eq('id', obra())] })
        const [trechos, planos, resumo] = await Promise.all([
          ler('obra_trecho', {
            colunas:
              'id, nome, tipo, comprimento_m, unidade_espaco_padrao, marcador_valor_inicial, geometry_sentido',
            filtros: [eq('obra_id', obra())],
            ordem: [{ coluna: 'ordem' }]
          }),
          ler('planejamento', {
            colunas: 'id, nome, is_baseline, vigente, status',
            filtros: [eq('obra_id', obra())]
          }),
          ler('vw_acompanhamento_obra_resumo', { filtros: [eq('obra_id', obra())] })
        ])
        return { obra: o, trechos, planos, resumo: resumo[0] ?? null }
      }
      case 'criar':
        return fn('create-obra', {
          nome: exigir(a.nome, 'nome', a.acao),
          codigo: exigir(a.codigo, 'codigo', a.acao),
          status: a.status,
          empresa_id: a.empresa_id ?? ctxAtual().perfil.empresa_id ?? undefined
        })
      case 'editar': {
        const patch: Record<string, unknown> = {}
        for (const k of [
          'nome',
          'codigo',
          'status',
          'rodovia',
          'trecho',
          'extensao_km',
          'data_base_orcamento',
          'data_inicio_planejada',
          'data_fim_planejada'
        ] as const)
          if (a[k] !== undefined) patch[k] = a[k]
        return (await gravar('obras', 'update', patch, [eq('id', obra())]))[0]
      }
      case 'ativar':
        return fn('set-obra-ativa', { obra_id: obra(), ativa: exigir(a.ativa, 'ativa', a.acao) })
      case 'excluir': {
        const [o] = await ler('obras', { colunas: 'id, codigo, nome', filtros: [eq('id', obra())] })
        if (!o) throw new Error('Obra não encontrada.')
        const impacto = {
          obra: o,
          itens_orcamento: await contar('item_orcamentario', [eq('obra_id', obra())]),
          planos: await contar('planejamento', [eq('obra_id', obra())]),
          lancamentos_producao: await contar('acompanhamento_producao', [eq('obra_id', obra())]),
          fotos: await contar('acompanhamento_foto', [eq('obra_id', obra())])
        }
        const pedido = pedirConfirmacao(
          a.confirmar,
          'EXCLUIR A OBRA E TUDO DELA (irreversível)',
          impacto
        )
        if (pedido) return pedido
        return fn('delete-obra', { obra_id: obra() })
      }
      case 'criar_empresa':
        return fn('create-empresa', { nome: exigir(a.nome, 'nome', a.acao), cnpj: a.cnpj })
    }
  }
})

export const usuarios = ferramenta({
  nome: 'usuarios',
  titulo: 'Usuários e acesso às obras',
  descricao:
    'Usuários (só god e adm). Papéis: god, adm (empresa), engenheiro (obras liberadas), apoio (do engenheiro), ' +
    'cliente (só leitura), apontador (só o app de campo). acao: listar | criar (email, nome, papel, senha ≥ 10; ' +
    'sem SMTP, a senha é definida aqui) | editar (nome, papel, vínculos, ativo, nova senha) | excluir | ' +
    'obras_do_usuario | conceder (libera a obra ao usuário) | revogar.',
  entrada: {
    acao: z.enum([
      'listar',
      'criar',
      'editar',
      'excluir',
      'obras_do_usuario',
      'conceder',
      'revogar'
    ]),
    id: z.string().uuid().optional().describe('usuário'),
    email: z.string().email().optional(),
    nome: z.string().optional(),
    role: PAPEL.optional(),
    empresa_id: z.string().uuid().nullable().optional(),
    engenheiro_id: z.string().uuid().nullable().optional(),
    whatsapp: z.string().nullable().optional().describe('número de contato com DDI e DDD'),
    senha: z.string().min(10).optional(),
    ativo: z.boolean().optional(),
    obra_id: OBRA.optional(),
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: {
    tabelas: ['profiles', 'obra_permissoes'],
    funcoes: [
      'create-usuario',
      'update-usuario',
      'delete-usuario',
      'grant-obra-permissao',
      'revoke-obra-permissao'
    ]
  },
  async executar(a) {
    const id = () => exigir(a.id, 'id', a.acao)
    switch (a.acao) {
      case 'listar':
        return ler('profiles', {
          colunas:
            'id, email, nome, role, empresa_id, engenheiro_id, ativo, whatsapp, created_at, last_access_at',
          ordem: [{ coluna: 'nome' }]
        })
      case 'criar':
        return fn('create-usuario', {
          email: exigir(a.email, 'email', a.acao),
          nome: exigir(a.nome, 'nome', a.acao),
          role: exigir(a.role, 'role', a.acao),
          empresa_id: a.empresa_id ?? null,
          engenheiro_id: a.engenheiro_id ?? null,
          whatsapp: a.whatsapp ?? null,
          password: exigir(a.senha, 'senha', a.acao)
        })
      case 'editar': {
        const body: Record<string, unknown> = { id: id() }
        for (const k of [
          'nome',
          'role',
          'empresa_id',
          'engenheiro_id',
          'whatsapp',
          'ativo',
          'senha'
        ] as const)
          if (a[k] !== undefined) body[k] = a[k]
        return fn('update-usuario', body)
      }
      case 'excluir': {
        const [u] = await ler('profiles', {
          colunas: 'id, nome, email, role',
          filtros: [eq('id', id())]
        })
        const pedido = pedirConfirmacao(a.confirmar, 'excluir usuário', { usuario: u })
        if (pedido) return pedido
        return fn('delete-usuario', { id: id() })
      }
      case 'obras_do_usuario':
        return ler('obra_permissoes', { filtros: [eq('user_id', id())] })
      case 'conceder':
        return fn('grant-obra-permissao', {
          obra_id: exigir(a.obra_id, 'obra_id', a.acao),
          user_id: id()
        })
      case 'revogar':
        return fn('revoke-obra-permissao', {
          obra_id: exigir(a.obra_id, 'obra_id', a.acao),
          user_id: id()
        })
    }
  }
})

export const trechos = ferramenta({
  nome: 'trechos',
  titulo: 'Locais da obra (eixos e áreas)',
  descricao:
    'Locais da obra: eixos (com estaqueamento; posições em metros internos a partir do início) e áreas (OAE, ' +
    'pátio…). Unidade de exibição km | m | estaca | custom (rótulo e divisor em metros). geometry_sentido ' +
    'natural|invertido (numeração contra o desenho). acao: listar | criar | editar | excluir | geometria (KML/KMZ ' +
    'em base64 ou coordenadas [[lng,lat],…]; calcula comprimento e limites) | sincronizar_tarefas (reaplica os ' +
    'locais nas tarefas depois de mudar comprimento/estaqueamento).',
  entrada: {
    acao: z.enum(['listar', 'criar', 'editar', 'excluir', 'geometria', 'sincronizar_tarefas']),
    obra_id: OBRA,
    id: z.string().uuid().optional(),
    nome: z.string().optional(),
    tipo: z.enum(['eixo', 'area']).optional(),
    ordem: z.number().int().optional(),
    unidade_espaco_padrao: z.enum(['km', 'm', 'estaca', 'custom']).optional(),
    unidade_custom_label: z.string().nullable().optional(),
    unidade_custom_divisor_m: z.number().nullable().optional(),
    comprimento_m: z
      .number()
      .nullable()
      .optional()
      .describe('eixo sem geometria: comprimento em metros'),
    marcador_valor_inicial: z
      .number()
      .optional()
      .describe('valor do marcador no início (ex.: km 12 → 12)'),
    geometry_sentido: z.enum(['natural', 'invertido']).optional(),
    cor: z.string().optional(),
    kml_base64: z.string().optional(),
    coordenadas: z.array(z.array(z.number())).optional(),
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: { tabelas: ['obra_trecho'], rpcs: ['trecho_sync_tarefas'] },
  async executar(a) {
    const id = () => exigir(a.id, 'id', a.acao)
    const campos = () => {
      const p: Record<string, unknown> = {}
      for (const k of [
        'nome',
        'tipo',
        'ordem',
        'unidade_espaco_padrao',
        'unidade_custom_label',
        'unidade_custom_divisor_m',
        'comprimento_m',
        'marcador_valor_inicial',
        'geometry_sentido',
        'cor'
      ] as const)
        if (a[k] !== undefined) p[k] = a[k]
      return p
    }
    switch (a.acao) {
      case 'listar':
        return ler('obra_trecho', {
          colunas:
            'id, nome, tipo, ordem, cor, unidade_espaco_padrao, unidade_custom_label, unidade_custom_divisor_m, ' +
            'marcador_valor_inicial, comprimento_m, geometry_comprimento_m, geometry_sentido, geometry_bounds',
          filtros: [eq('obra_id', a.obra_id)],
          ordem: [{ coluna: 'ordem' }]
        })
      case 'criar': {
        const tipo = a.tipo ?? 'eixo'
        return (
          await gravar('obra_trecho', 'insert', {
            unidade_espaco_padrao: 'km',
            ordem: 0,
            ...campos(),
            obra_id: a.obra_id,
            nome: exigir(a.nome, 'nome', a.acao).trim(),
            tipo,
            comprimento_m: tipo === 'area' ? null : (a.comprimento_m ?? null)
          })
        )[0]
      }
      case 'editar': {
        await gravar('obra_trecho', 'update', campos(), [eq('id', id())])
        return { ok: true, calculo: await recalcularEmEdicao(a.obra_id) }
      }
      case 'excluir': {
        const usos = await contar('planejamento_tarefa_local', [eq('trecho_id', id())])
        const pedido = pedirConfirmacao(a.confirmar, 'excluir local', {
          id: id(),
          locais_de_tarefas: usos
        })
        if (pedido) return pedido
        await gravar('obra_trecho', 'delete', null, [eq('id', id())])
        return { excluido: id() }
      }
      case 'geometria': {
        const g = a.kml_base64
          ? await geometriaDeKml(a.kml_base64)
          : geometriaDeCoordenadas(exigir(a.coordenadas, 'coordenadas (ou kml_base64)', a.acao))
        await gravar(
          'obra_trecho',
          'update',
          { ...g, ...(a.geometry_sentido ? { geometry_sentido: a.geometry_sentido } : {}) },
          [eq('id', id())]
        )
        return { comprimento_m: g.geometry_comprimento_m, limites: g.geometry_bounds }
      }
      case 'sincronizar_tarefas':
        return {
          resultado: await rpc('trecho_sync_tarefas', { _obra_id: a.obra_id }),
          calculo: await recalcularEmEdicao(a.obra_id)
        }
    }
  }
})

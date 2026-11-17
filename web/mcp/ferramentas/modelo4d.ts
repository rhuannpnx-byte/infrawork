import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ctxAtual, rpc } from '../contexto'
import { CONFIRMAR, exigir, ferramenta, pedirConfirmacao } from '../ferramenta'
import { eq, ler } from '../lib/banco'
import {
  caminhoDoModelo,
  compactar,
  descompactar,
  lerModelo
} from '@/features/modelo4d/lib/arquivo'
import { CONTRATO_TEXTO } from '@/features/modelo4d/lib/contrato-texto'
import type { Modelo4D } from '@/features/modelo4d/lib/contrato'
import { Estado4D, situacao, type Situacao, type Vinculos } from '@/features/modelo4d/lib/estado'
import {
  COLUNAS_WP,
  montarLancamentos,
  montarPlano,
  type LinhaProducao,
  type LinhaSemana,
  type LinhaWp
} from '@/features/modelo4d/lib/plano'
import { prepararModelo, resumirModelo, type ResumoModelo } from '@/features/modelo4d/lib/preparar'
import {
  montarPrompt,
  sugerirVinculos,
  type LocalContexto,
  type ServicoContexto
} from '@/features/modelo4d/lib/prompt'

const BUCKET = 'modelos-4d'
const OBRA = z.string().uuid().describe('id da obra')

interface Registro {
  id: string
  obra_id: string
  nome: string
  origem: string
  storage_path: string
  tamanho_bytes: number | null
  resumo: ResumoModelo
  ativo: boolean
  created_at: string
}

const locaisDaObra = (obra: string) =>
  ler<LocalContexto>('obra_trecho', {
    colunas:
      'id, nome, tipo, comprimento_m, unidade_espaco_padrao, unidade_custom_label, unidade_custom_divisor_m, marcador_valor_inicial, geometry_sentido',
    filtros: [eq('obra_id', obra)],
    ordem: [{ coluna: 'ordem' }]
  })

const servicosDaObra = (obra: string) =>
  ler<ServicoContexto>('item_orcamentario', {
    colunas: 'id, codigo, descricao, unidade',
    filtros: [
      eq('obra_id', obra),
      eq('tipo', 'servico_grupo'),
      { coluna: 'indireto_id', op: 'is', valor: null }
    ],
    ordem: [{ coluna: 'codigo' }]
  })

/** Trechos de tarefa e perfis da linha de base de referência (a vigente ou a última que foi vigente). */
async function planoDeReferencia(obra: string) {
  const [lb] = await ler<{ id: string; nome: string }>('planejamento', {
    colunas: 'id, nome',
    filtros: [
      eq('obra_id', obra),
      eq('is_baseline', true),
      { coluna: 'vigente_em', op: 'not_is', valor: null }
    ],
    ordem: [
      { coluna: 'vigente', asc: false },
      { coluna: 'vigente_em', asc: false }
    ],
    limite: 1
  })
  if (!lb) return { linha_de_base: null, ...montarPlano([], []) }
  const [wps, tarefas] = await Promise.all([
    ler<LinhaWp>('planejamento_tarefa_wp', {
      colunas: COLUNAS_WP,
      filtros: [eq('planejamento_id', lb.id)],
      ordem: [{ coluna: 'tarefa_id' }, { coluna: 'ordem' }]
    }),
    ler<{ id: string }>('planejamento_tarefa', {
      colunas: 'id',
      filtros: [eq('planejamento_id', lb.id)]
    })
  ])
  const semanas: LinhaSemana[] = []
  for (let i = 0; i < tarefas.length; i += 100) {
    semanas.push(
      ...(await ler<LinhaSemana>('planejamento_tarefa_perfil_semana', {
        colunas: 'tarefa_id, semana_segunda, quantidade_planejada',
        filtros: [
          { coluna: 'tarefa_id', op: 'in', valor: tarefas.slice(i, i + 100).map((t) => t.id) }
        ],
        ordem: [{ coluna: 'tarefa_id' }, { coluna: 'semana_segunda' }]
      }))
    )
  }
  return { linha_de_base: lb, ...montarPlano(wps, semanas) }
}

async function textoDoArquivo(a: { arquivo_base64?: string; url?: string }): Promise<string> {
  if (a.arquivo_base64)
    return Buffer.from(a.arquivo_base64.replace(/^data:[^,]*,/, ''), 'base64').toString('utf-8')
  if (a.url) {
    const r = await fetch(a.url)
    if (!r.ok) throw new Error(`Não consegui baixar o arquivo (${r.status}).`)
    return r.text()
  }
  throw new Error('Mande arquivo_base64 ou url.')
}

const vinculosDe = async (modelo: string) => {
  const [eixos, classes] = await Promise.all([
    ler<{ eixo: string; trecho_id: string }>('modelo4d_eixo', {
      colunas: 'eixo, trecho_id',
      filtros: [eq('modelo_id', modelo)],
      ordem: [{ coluna: 'eixo' }]
    }),
    ler<{ classe: string; item_orcamentario_id: string }>('modelo4d_vinculo', {
      colunas: 'classe, item_orcamentario_id',
      filtros: [eq('modelo_id', modelo)],
      ordem: [{ coluna: 'classe' }]
    })
  ])
  return { eixos, classes }
}

export const modelo4d = ferramenta({
  nome: 'modelo_da_obra',
  titulo: 'Acompanhamento 4D (modelo 3D ligado ao plano)',
  descricao:
    'Modelo 3D da obra no contrato infrawork-4d, ligado ao plano pela estaca (beta). acao: contrato (o formato ' +
    'do arquivo) | contexto (prompt com o contrato, o estaqueamento e os serviços da linha de base: use para ' +
    'gerar o modelo já com o código do serviço em cada classe) | enviar (HTML da construção digital ou JSON ' +
    'do contrato, em arquivo_base64 ou url; vincula sozinho pelo código do serviço e pelo nome) | listar ' +
    '(modelos, classes e vínculos) | vincular (eixo do modelo → local; classe → serviço) | ativar | estado ' +
    '(previsto e realizado por serviço e a situação das peças numa data) | excluir. Serviço vinculado passa a ' +
    'exigir local com estacas no lançamento; produção sem estaca não aparece no 3D.',
  entrada: {
    acao: z.enum([
      'contrato',
      'contexto',
      'enviar',
      'listar',
      'vincular',
      'ativar',
      'estado',
      'excluir'
    ]),
    obra_id: OBRA.optional(),
    id: z.string().uuid().optional().describe('id do modelo'),
    nome: z.string().optional().describe('enviar: nome do modelo (padrão: o do arquivo)'),
    arquivo_base64: z.string().optional().describe('enviar: o arquivo em base64'),
    url: z.string().url().optional().describe('enviar: ou o endereço https do arquivo'),
    eixos: z
      .array(z.object({ eixo: z.string(), trecho_id: z.string().uuid() }))
      .optional()
      .describe('vincular: eixo do modelo → local (eixo) da obra'),
    classes: z
      .array(z.object({ classe: z.string(), item_orcamentario_id: z.string().uuid() }))
      .optional()
      .describe('vincular: classe do modelo → serviço (agrupador direto)'),
    data: z.string().optional().describe('estado: AAAA-MM-DD (padrão: hoje)'),
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: {
    tabelas: ['modelo4d', 'modelo4d_eixo', 'modelo4d_vinculo'],
    rpcs: ['modelo4d_registrar', 'modelo4d_vincular', 'modelo4d_ativar', 'modelo4d_excluir']
  },
  async executar(a) {
    const c = ctxAtual()
    switch (a.acao) {
      case 'contrato':
        return { contrato: CONTRATO_TEXTO }

      case 'contexto': {
        const obra = exigir(a.obra_id, 'obra_id', a.acao)
        const [[o], locais, servicos, plano] = await Promise.all([
          ler<{ codigo: string; nome: string }>('obras', {
            colunas: 'codigo, nome',
            filtros: [eq('id', obra)]
          }),
          locaisDaObra(obra),
          servicosDaObra(obra),
          planoDeReferencia(obra)
        ])
        return {
          linha_de_base: plano.linha_de_base,
          prompt: montarPrompt({
            obra: o ? `${o.codigo} · ${o.nome}` : obra,
            locais,
            servicos,
            plano: plano.trechos
          })
        }
      }

      case 'enviar': {
        const obra = exigir(a.obra_id, 'obra_id', a.acao)
        const lido = lerModelo(await textoDoArquivo(a))
        if ('erros' in lido) return { importado: false, erros: lido.erros }
        const resumo = resumirModelo(prepararModelo(lido.modelo))
        const [locais, servicos] = await Promise.all([locaisDaObra(obra), servicosDaObra(obra)])
        const eixosObra = locais.filter((l) => l.tipo === 'eixo')
        const eixos =
          resumo.eixos.length === 1 && eixosObra.length === 1
            ? [{ eixo: resumo.eixos[0].id, trecho_id: eixosObra[0].id }]
            : []
        const sugeridos = sugerirVinculos(resumo.classes, servicos)
        const classes = Object.entries(sugeridos).map(([classe, item_orcamentario_id]) => ({
          classe,
          item_orcamentario_id
        }))
        const id = randomUUID()
        const caminho = caminhoDoModelo(obra, id)
        const arquivo = await compactar(JSON.stringify(lido.modelo))
        const up = await c.sb.storage
          .from(BUCKET)
          .upload(caminho, arquivo, { contentType: 'application/gzip', upsert: false })
        if (up.error) throw new Error(`Envio do arquivo: ${up.error.message}`)
        try {
          await rpc('modelo4d_registrar', {
            _obra_id: obra,
            _id: id,
            _nome: a.nome?.trim() || lido.modelo.nome,
            _origem: lido.origem,
            _tamanho_bytes: arquivo.size,
            _resumo: resumo,
            _eixos: eixos,
            _vinculos: classes
          })
        } catch (e) {
          await c.sb.storage.from(BUCKET).remove([caminho])
          throw e
        }
        const codigo = new Map(servicos.map((s) => [s.id, s.codigo]))
        return {
          importado: true,
          id,
          eixos_vinculados: eixos.length,
          classes: resumo.classes.map((k) => ({
            classe: k.id,
            nome: k.nome,
            pecas: k.pecas,
            contexto: k.contexto,
            servico: sugeridos[k.id] ? codigo.get(sugeridos[k.id]) : null
          })),
          falta_vincular: [
            ...(eixos.length ? [] : ['nenhum eixo foi ligado a um local: use vincular']),
            ...resumo.classes
              .filter((k) => !k.contexto && !sugeridos[k.id])
              .map((k) => `classe ${k.id} (${k.nome}) sem serviço`)
          ]
        }
      }

      case 'listar': {
        const obra = exigir(a.obra_id, 'obra_id', a.acao)
        const modelos = await ler<Registro>('modelo4d', {
          colunas:
            'id, obra_id, nome, origem, storage_path, tamanho_bytes, resumo, ativo, created_at',
          filtros: [eq('obra_id', obra)],
          ordem: [{ coluna: 'created_at', asc: false }]
        })
        return Promise.all(
          modelos.map(async (m) => ({
            id: m.id,
            nome: m.nome,
            origem: m.origem,
            ativo: m.ativo,
            criado_em: m.created_at,
            tamanho_bytes: m.tamanho_bytes,
            extensao_m: m.resumo?.extensao_m,
            eixos: m.resumo?.eixos,
            classes: m.resumo?.classes,
            vinculos: await vinculosDe(m.id)
          }))
        )
      }

      case 'vincular': {
        const id = exigir(a.id, 'id', a.acao)
        await rpc('modelo4d_vincular', {
          _modelo_id: id,
          _eixos: a.eixos ?? [],
          _vinculos: a.classes ?? []
        })
        return { id, ...(await vinculosDe(id)) }
      }

      case 'ativar': {
        const id = exigir(a.id, 'id', a.acao)
        await rpc('modelo4d_ativar', { _modelo_id: id })
        return { ativo: id }
      }

      case 'estado': {
        const obra = exigir(a.obra_id, 'obra_id', a.acao)
        const filtros = a.id ? [eq('id', a.id)] : [eq('obra_id', obra), eq('ativo', true)]
        const [m] = await ler<Registro>('modelo4d', {
          colunas: 'id, obra_id, nome, storage_path, resumo, ativo, created_at',
          filtros
        })
        if (!m) throw new Error('A obra não tem modelo 4D em uso.')
        const baixado = await c.sb.storage.from(BUCKET).download(m.storage_path)
        if (baixado.error) throw new Error(`Arquivo do modelo: ${baixado.error.message}`)
        const pronto = prepararModelo(JSON.parse(await descompactar(baixado.data)) as Modelo4D)
        const [gravados, locais, servicos, plano, producao] = await Promise.all([
          vinculosDe(m.id),
          locaisDaObra(obra),
          servicosDaObra(obra),
          planoDeReferencia(obra),
          ler<LinhaProducao>('vw_acompanhamento_producao_enriquecida', {
            colunas:
              'id, data, item_orcamentario_id, trecho_id, posicao_inicio_m, posicao_fim_m, qtd, qtd_convertida',
            filtros: [eq('obra_id', obra)],
            ordem: [{ coluna: 'data' }]
          })
        ])
        const vinculos: Vinculos = {
          eixos: Object.fromEntries(
            gravados.eixos.flatMap((e) => {
              const l = locais.find((x) => x.id === e.trecho_id)
              return l ? [[e.eixo, l]] : []
            })
          ),
          classes: Object.fromEntries(
            gravados.classes.map((k) => [k.classe, k.item_orcamentario_id])
          )
        }
        const estado = new Estado4D(
          pronto,
          plano.trechos,
          montarLancamentos(producao),
          vinculos,
          plano.perfis
        )
        const dia = a.data ?? new Date().toISOString().slice(0, 10)
        const t = new Date(`${dia}T23:59:59`).getTime()
        estado.calcular(t)
        const servico = new Map(servicos.map((s) => [s.id, s]))
        const classes = pronto.modelo.classes.map((k, ic) => {
          const conta: Record<Situacao, number> = {
            concluido: 0,
            adiantado: 0,
            execucao: 0,
            atrasado: 0,
            nao_iniciado: 0
          }
          let vinculadas = 0
          for (const i of pronto.malhas[ic].pecas) {
            if (!estado.vinculada[i]) continue
            vinculadas++
            conta[situacao(estado.prev[i], estado.real[i])]++
          }
          const item = vinculos.classes[k.id]
          return {
            classe: k.id,
            nome: k.nome,
            servico: item ? (servico.get(item)?.codigo ?? item) : null,
            pecas: pronto.malhas[ic].pecas.length,
            ...(vinculadas ? { situacao: conta } : {})
          }
        })
        return {
          modelo: { id: m.id, nome: m.nome },
          data: dia,
          linha_de_base: plano.linha_de_base,
          servicos: estado.resumo(t).map((r) => ({
            codigo: servico.get(r.item_id)?.codigo ?? r.item_id,
            servico: servico.get(r.item_id)?.descricao,
            unidade: servico.get(r.item_id)?.unidade,
            quantidade_plano: r.total,
            previsto: r.previsto,
            realizado: r.realizado
          })),
          classes,
          lancamentos_sem_estaca: estado.semEstaca.length,
          nota: 'situacao conta as peças do modelo (fatias de até 20 m) por estado na data; atrasado = menos feito do que o plano previa para aquela estaca.'
        }
      }

      case 'excluir': {
        const id = exigir(a.id, 'id', a.acao)
        const [m] = await ler<Registro>('modelo4d', {
          colunas: 'id, nome, ativo',
          filtros: [eq('id', id)]
        })
        if (!m) throw new Error('Modelo não encontrado.')
        const pedido = pedirConfirmacao(a.confirmar, 'excluir modelo 4D', {
          modelo: m.nome,
          em_uso: m.ativo,
          vinculos: await vinculosDe(id)
        })
        if (pedido) return pedido
        const caminho = await rpc<string | null>('modelo4d_excluir', { _modelo_id: id })
        if (caminho) await c.sb.storage.from(BUCKET).remove([caminho])
        return { excluido: id }
      }
    }
  }
})

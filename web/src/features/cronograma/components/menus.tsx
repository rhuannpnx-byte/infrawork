/**
 * Menus de contexto comuns às visões do cronograma (o `ContextMenuHelper` do ApeX): tarefas, tarefas-resumo e
 * dependências, com os comandos que gravam no plano.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  FolderInput,
  FolderPlus,
  ListPlus,
  Merge,
  Pencil,
  Route,
  Scissors,
  Trash2,
  Wand2
} from 'lucide-react'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { contar } from '@/lib/rotulos'
import type { CalculoCronograma } from '../hooks/calculo'
import {
  useAtualizarTarefas,
  useCombinarTarefas,
  useComandoVisao,
  useExcluirDependencias,
  useExcluirTarefas,
  useMoverTarefas,
  useMudarTrecho,
  useRenomearAuto,
  useSalvarMarco
} from '../hooks/edicao'
import type { ComandoEdicao } from '../motor/edicao'
import type { TarefaEntrada, TipoDependencia } from '../motor/tipos'
import { MenuContexto, type ItemMenu } from './MenuContexto'

export interface AcoesCronograma {
  abrirTarefa: (id: string) => void
  abrirGrupo: (id: string) => void
  abrirPlano: () => void
  abrirDependencia: (d: {
    id: string | null
    pred: string
    succ: string
    tipo: TipoDependencia
    derivada?: boolean
  }) => void
  criarTarefas: (paiId: string | null) => void
  novoGrupo: (paiId: string | null) => void
  /** "Split by station" (ApeX): várias tarefas na mesma estaca quando vem do tempo-caminho */
  dividirEstaca: (alvo: { tarefaIds: string[]; trechoId?: string; estacaM?: number }) => void
  dividirQuantidade: (tarefaId: string) => void
  /** editar o eixo/área (duplo clique na linha do local) */
  abrirLocal: (trechoId: string) => void
}

export interface DependenciaMenu {
  id: string | null
  pred: string
  succ: string
  tipo: TipoDependencia
  usuario: boolean
}

export interface MenusCronograma {
  abrir: (itens: ItemMenu[], x: number, y: number) => void
  menuTarefas: (ids: string[], x: number, y: number) => void
  menuGrupo: (id: string, x: number, y: number) => void
  menuDependencia: (d: DependenciaMenu, x: number, y: number) => void
  remover: (ids: string[]) => Promise<void>
  removerDependencia: (id: string) => void
  executar: (cmd: ComandoEdicao) => Promise<void>
  /** "Rename tasks automatically" em todo o plano */
  renomearTudo: () => void
  elemento: ReactNode
}

export function useMenusCronograma(
  calc: CalculoCronograma,
  somenteLeitura: boolean,
  acoes: AcoesCronograma,
  aoRemover?: () => void
): MenusCronograma {
  const e = calc.entrada
  const planoId = e?.plano.id ?? ''
  const confirmar = useConfirm()
  const comando = useComandoVisao()
  const atualizarTarefas = useAtualizarTarefas()
  const mover = useMoverTarefas()
  const excluir = useExcluirTarefas()
  const excluirDeps = useExcluirDependencias()
  const salvarMarco = useSalvarMarco()
  const combinar = useCombinarTarefas()
  const mudarTrecho = useMudarTrecho()
  const renomear = useRenomearAuto()
  const [menu, setMenu] = useState<{ x: number; y: number; itens: ItemMenu[] } | null>(null)

  const porId = useMemo(() => new Map((e?.tarefas ?? []).map((t) => [t.id, t])), [e])
  const grupos = useMemo(() => (e?.tarefas ?? []).filter((t) => t.tipo_no === 'grupo'), [e])
  const trechos = useMemo(() => new Map((e?.trechos ?? []).map((t) => [t.id, t])), [e])
  const temEixo = (t: TarefaEntrada): boolean =>
    t.locais.some((l) => l.trecho_id && trechos.get(l.trecho_id)?.tipo === 'eixo')
  /** `SetRoadLine` em todas as selecionadas; avisa os locais que viraram manuais */
  const mudarTrechoDe = async (ts: TarefaEntrada[], trechoId: string | null): Promise<void> => {
    const avisos: string[] = []
    try {
      for (const t of ts) {
        const r = await mudarTrecho.mutateAsync({
          planejamentoId: planoId,
          tarefaId: t.id,
          trechoId
        })
        avisos.push(...r.avisos)
      }
      if (avisos.length) toast.warning(avisos.slice(0, 4).join(' · '))
    } catch (x) {
      toast.error((x as Error).message)
    }
  }
  const renomearTudo = (): void =>
    renomear.mutate(
      { planejamentoId: planoId, ids: null },
      {
        onSuccess: (n) =>
          toast.success(
            n ? `${contar(n, 'tarefa renomeada', 'tarefas renomeadas')}.` : 'Nada a renomear.'
          ),
        onError: (x) => toast.error(x.message)
      }
    )
  const caminho = (id: string): string[] => {
    const out: string[] = []
    for (let x: string | null = id; x; x = porId.get(x)?.parent_id ?? null) out.unshift(x)
    return out
  }
  const rotuloGrupo = (g: TarefaEntrada): string =>
    caminho(g.id)
      .map((x) => porId.get(x)?.nome ?? '')
      .join(' › ')
  const erro = (x: Error): void => void toast.error(x.message)

  /** Executa o comando; a promessa termina com a prévia aplicada (ou o aviso/erro mostrado) e nunca rejeita. */
  const executar = async (cmd: ComandoEdicao): Promise<void> => {
    if (!e) return
    try {
      const r = await comando.mutateAsync({ planejamentoId: planoId, sig: calc.sig, comando: cmd })
      if (r.aviso) toast.info(r.aviso)
    } catch (x) {
      erro(x as Error)
    }
  }

  const remover = async (ids: string[]): Promise<void> => {
    const grs = ids.filter((x) => porId.get(x)?.tipo_no === 'grupo')
    const ok = await confirmar({
      title: ids.length === 1 ? 'Remover do plano?' : `Remover ${ids.length} itens do plano?`,
      description: grs.length
        ? 'Remover uma tarefa-resumo remove tudo o que está dentro dela.'
        : 'As dependências das tarefas removidas também saem.',
      confirmLabel: 'Remover',
      variant: 'danger'
    })
    if (!ok) return
    excluir.mutate(
      { planejamentoId: planoId, ids },
      { onSuccess: () => aoRemover?.(), onError: erro }
    )
  }

  /** Subir/descer entre os irmãos (a ordem da EAP). */
  const reordenar = (id: string, delta: -1 | 1): void => {
    const t = porId.get(id)
    if (!t) return
    const irmaos = (e?.tarefas ?? [])
      .filter((x) => (x.parent_id ?? null) === (t.parent_id ?? null))
      .sort((a, b) => a.ordem - b.ordem)
    const i = irmaos.findIndex((x) => x.id === id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= irmaos.length) return
    const antes = delta < 0 ? irmaos[j]!.id : (irmaos[j + 1]?.id ?? null)
    mover.mutate({ planejamentoId: planoId, ids: [id], pai: t.parent_id, antes }, { onError: erro })
  }
  const podeMover = (id: string, delta: -1 | 1): boolean => {
    const t = porId.get(id)
    if (!t) return false
    const irmaos = (e?.tarefas ?? [])
      .filter((x) => (x.parent_id ?? null) === (t.parent_id ?? null))
      .sort((a, b) => a.ordem - b.ordem)
    const i = irmaos.findIndex((x) => x.id === id)
    return delta < 0 ? i > 0 : i >= 0 && i < irmaos.length - 1
  }

  const menuTarefas = (ids: string[], x: number, y: number): void => {
    const ts = ids
      .map((k) => porId.get(k))
      .filter((t): t is TarefaEntrada => !!t && t.tipo_no === 'tarefa')
    if (!ts.length) return
    const primeira = ts[0]!
    const todasAsap = ts.every((t) => t.asap)
    const crescente = primeira.sentido !== 'decrescente'
    const ro = somenteLeitura
    const lote = (campos: { asap?: boolean; sentido?: 'crescente' | 'decrescente' }): void =>
      atualizarTarefas.mutate(
        { planejamentoId: planoId, itens: ts.map((t) => ({ id: t.id, ...campos })) },
        { onError: erro }
      )
    setMenu({
      x,
      y,
      itens: [
        {
          rotulo: 'Propriedades…',
          padrao: true,
          icone: <Pencil size={12} />,
          acao: () => acoes.abrirTarefa(primeira.id)
        },
        'sep',
        {
          rotulo: 'O mais cedo possível',
          marcado: todasAsap,
          desabilitado: ro,
          acao: () => lote({ asap: !todasAsap })
        },
        {
          rotulo: 'Do início do trecho (estacas crescentes)',
          marcado: crescente,
          desabilitado: ro,
          acao: () => lote({ sentido: 'crescente' })
        },
        {
          rotulo: 'Do fim do trecho (estacas decrescentes)',
          marcado: !crescente,
          desabilitado: ro,
          acao: () => lote({ sentido: 'decrescente' })
        },
        'sep',
        {
          rotulo: 'Mover para a tarefa-resumo',
          icone: <FolderInput size={12} />,
          desabilitado: ro,
          sub: [
            {
              rotulo: 'Raiz do plano',
              acao: () =>
                mover.mutate(
                  { planejamentoId: planoId, ids: ts.map((t) => t.id), pai: null, antes: null },
                  { onError: erro }
                )
            },
            ...grupos.map((g) => ({
              rotulo: rotuloGrupo(g),
              acao: () =>
                mover.mutate(
                  { planejamentoId: planoId, ids: ts.map((t) => t.id), pai: g.id, antes: null },
                  { onError: erro }
                )
            }))
          ]
        },
        {
          rotulo: 'Subir',
          icone: <ArrowUp size={12} />,
          desabilitado: ro || ts.length !== 1 || !podeMover(primeira.id, -1),
          acao: () => reordenar(primeira.id, -1)
        },
        {
          rotulo: 'Descer',
          icone: <ArrowDown size={12} />,
          desabilitado: ro || ts.length !== 1 || !podeMover(primeira.id, 1),
          acao: () => reordenar(primeira.id, 1)
        },
        {
          rotulo: 'Adicionar ao marco',
          desabilitado: ro,
          sub: (e?.marcos ?? []).map((m) => ({
            rotulo: m.nome,
            acao: () =>
              salvarMarco.mutate(
                {
                  planejamentoId: planoId,
                  id: m.id,
                  campos: {
                    ...m,
                    descricao: undefined,
                    incluidas: [...new Set([...m.incluidas, ...ts.map((t) => t.id)])],
                    excluidas: m.excluidas.filter((x) => !ts.some((t) => t.id === x))
                  }
                },
                { onError: erro }
              )
          }))
        },
        'sep',
        {
          rotulo: 'Dividir por estaca…',
          icone: <Scissors size={12} />,
          desabilitado: ro || ts.length !== 1 || !temEixo(primeira),
          acao: () => acoes.dividirEstaca({ tarefaIds: [primeira.id] })
        },
        {
          rotulo: 'Dividir por quantidade…',
          icone: <Scissors size={12} />,
          desabilitado: ro || ts.length !== 1 || primeira.is_indireto,
          acao: () => acoes.dividirQuantidade(primeira.id)
        },
        {
          rotulo:
            ts.length > 1 ? `Combinar ${ts.length} tarefas` : 'Combinar (selecione 2 ou mais)',
          icone: <Merge size={12} />,
          desabilitado:
            ro ||
            ts.length < 2 ||
            ts.some((t) => t.item_orcamentario_id !== primeira.item_orcamentario_id),
          acao: () =>
            combinar.mutate(
              { planejamentoId: planoId, ids: ts.map((t) => t.id) },
              { onSuccess: () => toast.success('Tarefas combinadas.'), onError: erro }
            )
        },
        {
          rotulo: 'Mudar de trecho',
          icone: <Route size={12} />,
          desabilitado: ro,
          sub: [
            { rotulo: 'Sem local', acao: () => void mudarTrechoDe(ts, null) },
            ...(e?.trechos ?? [])
              .filter((t) => t.tipo === 'eixo')
              .map((t) => ({ rotulo: t.nome, acao: () => void mudarTrechoDe(ts, t.id) })),
            ...(e?.trechos ?? [])
              .filter((t) => t.tipo === 'area')
              .map((t) => ({ rotulo: `Área ${t.nome}`, acao: () => void mudarTrechoDe(ts, t.id) }))
          ]
        },
        ...(ts.some((t) => Math.abs(t.coef_producao - 1) > 1e-9)
          ? [
              {
                rotulo: 'Usar a produtividade da composição',
                desabilitado: ro,
                acao: () =>
                  atualizarTarefas.mutate(
                    {
                      planejamentoId: planoId,
                      itens: ts
                        .filter((t) => Math.abs(t.coef_producao - 1) > 1e-9)
                        .map((t) => ({ id: t.id, coef_producao: 1 }))
                    },
                    {
                      onSuccess: () =>
                        toast.success('Produtividade de volta à da composição (× equipes).'),
                      onError: erro
                    }
                  )
              } as ItemMenu
            ]
          : []),
        {
          rotulo: 'Renomear automaticamente',
          icone: <Wand2 size={12} />,
          desabilitado: ro,
          acao: () =>
            renomear.mutate(
              { planejamentoId: planoId, ids: ts.map((t) => t.id) },
              {
                onSuccess: (n) =>
                  toast.success(`${contar(n, 'tarefa renomeada', 'tarefas renomeadas')}.`),
                onError: erro
              }
            )
        },
        'sep',
        {
          rotulo: 'Nova dependência a partir desta…',
          icone: <ArrowRightLeft size={12} />,
          desabilitado: ro || ts.length !== 1,
          acao: () => acoes.abrirDependencia({ id: null, pred: primeira.id, succ: '', tipo: 'FS' })
        },
        'sep',
        {
          rotulo: ts.length > 1 ? `Remover ${ts.length} tarefas` : 'Remover',
          perigo: true,
          icone: <Trash2 size={12} />,
          desabilitado: ro,
          atalho: 'Del',
          acao: () => void remover(ts.map((t) => t.id))
        }
      ]
    })
  }

  const menuGrupo = (id: string, x: number, y: number): void => {
    const ro = somenteLeitura
    setMenu({
      x,
      y,
      itens: [
        {
          rotulo: 'Propriedades…',
          padrao: true,
          icone: <Pencil size={12} />,
          acao: () => acoes.abrirGrupo(id)
        },
        'sep',
        {
          rotulo: 'Criar tarefas aqui…',
          icone: <ListPlus size={12} />,
          desabilitado: ro,
          acao: () => acoes.criarTarefas(id)
        },
        {
          rotulo: 'Nova tarefa-resumo dentro…',
          icone: <FolderPlus size={12} />,
          desabilitado: ro,
          acao: () => acoes.novoGrupo(id)
        },
        {
          rotulo: 'Mover para',
          icone: <FolderInput size={12} />,
          desabilitado: ro,
          sub: [
            {
              rotulo: 'Raiz do plano',
              acao: () =>
                mover.mutate(
                  { planejamentoId: planoId, ids: [id], pai: null, antes: null },
                  { onError: erro }
                )
            },
            ...grupos
              .filter((g) => g.id !== id && !caminho(g.id).includes(id))
              .map((g) => ({
                rotulo: rotuloGrupo(g),
                acao: () =>
                  mover.mutate(
                    { planejamentoId: planoId, ids: [id], pai: g.id, antes: null },
                    { onError: erro }
                  )
              }))
          ]
        },
        {
          rotulo: 'Subir',
          icone: <ArrowUp size={12} />,
          desabilitado: ro || !podeMover(id, -1),
          acao: () => reordenar(id, -1)
        },
        {
          rotulo: 'Descer',
          icone: <ArrowDown size={12} />,
          desabilitado: ro || !podeMover(id, 1),
          acao: () => reordenar(id, 1)
        },
        'sep',
        {
          rotulo: 'Remover com o conteúdo',
          perigo: true,
          icone: <Trash2 size={12} />,
          desabilitado: ro,
          acao: () => void remover([id])
        }
      ]
    })
  }

  const menuDependencia = (d: DependenciaMenu, x: number, y: number): void => {
    setMenu({
      x,
      y,
      itens: d.usuario
        ? [
            {
              rotulo: 'Propriedades…',
              padrao: true,
              icone: <Pencil size={12} />,
              acao: () =>
                acoes.abrirDependencia({ id: d.id, pred: d.pred, succ: d.succ, tipo: d.tipo })
            },
            'sep',
            {
              rotulo: 'Remover',
              perigo: true,
              icone: <Trash2 size={12} />,
              desabilitado: somenteLeitura,
              acao: () =>
                d.id &&
                excluirDeps.mutate({ planejamentoId: planoId, ids: [d.id] }, { onError: erro })
            }
          ]
        : [
            {
              rotulo: 'Regra entre serviços…',
              padrao: true,
              icone: <Pencil size={12} />,
              acao: () =>
                acoes.abrirDependencia({
                  id: null,
                  pred: d.pred,
                  succ: d.succ,
                  tipo: 'EST',
                  derivada: true
                })
            }
          ]
    })
  }

  const removerDependencia = (id: string): void =>
    excluirDeps.mutate({ planejamentoId: planoId, ids: [id] }, { onError: erro })

  const elemento: ReactNode = menu ? (
    <MenuContexto x={menu.x} y={menu.y} itens={menu.itens} onFechar={() => setMenu(null)} />
  ) : null

  return {
    abrir: (itens: ItemMenu[], x: number, y: number) => setMenu({ x, y, itens }),
    menuTarefas,
    menuGrupo,
    menuDependencia,
    remover,
    removerDependencia,
    executar,
    renomearTudo,
    elemento
  }
}

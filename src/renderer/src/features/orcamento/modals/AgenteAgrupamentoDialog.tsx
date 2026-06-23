// Workbench do Agente de Agrupamento (Planilha Orçamentária).
//
// Layout de 3 painéis em tela quase cheia:
//   - Esquerda  (PainelCobertura): barras de cobertura por serviço; clique
//                destaca as receitas daquele serviço no centro.
//   - Centro    (PainelProposta): proposta editável + diff "ao vivo" do que o
//                agente mudou no último turno (verde entrou / vermelho saiu).
//   - Direita   (PainelChat): conversa multi-turno; cada instrução refina o
//                plano e o agente responde em linguagem natural.
//
// O agente em si (Edge Function assíncrona job+polling) não muda — só ganhou
// `resposta_agente` na saída e `historico_chat` no input.

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Sparkles, Check, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useSugerirAgrupamento, useRegistrarFeedbackAgrupamento } from '../hooks/agente-agrupamento'
import { useAgruparComoServico, usePlanOrc } from '../hooks/plan-orc'
import { useServicos } from '../hooks/servicos'
import { useServicoCustoAgregado } from '../hooks/servico-links'
import { parseBR } from '@/lib/money'
import type {
  AgrupamentoResposta,
  GrupoSugerido,
  MensagemChat,
  QtdRefModoAgente,
  ReceitaNaoAgrupada,
  FeedbackAgrupamentoInput
} from '@/types/agrupamento'
import { toVM, buildOmissosTree, type GrupoVM } from './agente/agente-shared'
import { diffPlanos, DIFF_TTL_MS, type DiffResult } from './agente/diff'
import { PainelCobertura } from './agente/PainelCobertura'
import { PainelProposta } from './agente/PainelProposta'
import { PainelChat } from './agente/PainelChat'
import { Splitter } from './agente/Splitter'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
}

export function AgenteAgrupamentoDialog({ open, onOpenChange, obraId }: Props): ReactNode {
  const sugerir = useSugerirAgrupamento()
  const agrupar = useAgruparComoServico()
  const feedback = useRegistrarFeedbackAgrupamento()

  const { data: plan } = usePlanOrc(obraId)
  const { data: servicos = [] } = useServicos(obraId)
  const { data: custoAgregado = [] } = useServicoCustoAgregado(obraId)

  const [resp, setResp] = useState<AgrupamentoResposta | null>(null)
  const [grupos, setGrupos] = useState<GrupoVM[]>([])
  const [naoAgrupados, setNaoAgrupados] = useState<ReceitaNaoAgrupada[]>([])
  const [mensagens, setMensagens] = useState<MensagemChat[]>([])
  const [servicoSelecionadoId, setServicoSelecionadoId] = useState<string | null>(null)
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [applyingKey, setApplyingKey] = useState<string | null>(null)
  const [applyingAll, setApplyingAll] = useState(false)
  const [leftW, setLeftW] = useState(300)
  const [rightW, setRightW] = useState(380)
  const diffTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Mapas de apoio ───────────────────────────────────────────────────────
  const qtdPorReceita = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of plan?.flat ?? []) m.set(n.id, n.quantidade ?? 0)
    return m
  }, [plan])

  const totalReceitas = useMemo(
    () => (plan?.flat ?? []).filter((n) => n.tipo === 'receita').length,
    [plan]
  )

  // Valor de venda por receita + total da obra (para a cobertura em R$).
  const vendaPorReceita = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of plan?.flat ?? []) {
      if (n.tipo === 'receita') m.set(n.id, n.venda_total_calc ?? 0)
    }
    return m
  }, [plan])

  const totalVenda = useMemo(() => {
    let t = 0
    for (const v of vendaPorReceita.values()) t += v
    return t
  }, [vendaPorReceita])

  const servicosFolha = useMemo(() => servicos.filter((s) => s.unidade !== null), [servicos])
  const custoPorServico = useMemo(
    () => new Map(custoAgregado.map((c) => [c.servico_id, c])),
    [custoAgregado]
  )

  // Árvore da EAP dos itens omissos (etapas → receitas não agrupadas).
  const omissosTree = useMemo(
    () => buildOmissosTree(plan?.flat ?? [], naoAgrupados, vendaPorReceita),
    [plan, naoAgrupados, vendaPorReceita]
  )

  const busy = sugerir.isPending || applyingAll || applyingKey !== null
  const trabalhando = sugerir.isPending

  const reset = (): void => {
    if (diffTimer.current) clearTimeout(diffTimer.current)
    setResp(null)
    setGrupos([])
    setNaoAgrupados([])
    setMensagens([])
    setServicoSelecionadoId(null)
    setDiff(null)
    setApplyingKey(null)
    setApplyingAll(false)
  }

  const planoAtualParaModelo = (): GrupoSugerido[] =>
    grupos
      .filter((g) => !g.aplicado)
      .map((g) => ({
        descricao: g.descricao,
        servico_id: g.servico_id,
        servico_codigo: g.servico_codigo,
        servico_nome: g.servico_nome,
        servico_unidade: g.servico_unidade,
        confianca: g.confianca,
        justificativa: g.justificativa,
        receitas: g.receitas,
        qtd_ref_modo: g.qtd_ref_modo,
        qtd_ref_sugerida: g.qtd_ref_sugerida,
        alertas_compartilhamento: g.alertas_compartilhamento
      }))

  // ── Conversa / geração ─────────────────────────────────────────────────────
  const enviar = async (instrucao?: string): Promise<void> => {
    const comRefino = resp != null
    const novasMsgs: MensagemChat[] = instrucao
      ? [...mensagens, { role: 'user', texto: instrucao }]
      : mensagens
    if (instrucao) setMensagens(novasMsgs)
    const planoAnterior = planoAtualParaModelo()
    try {
      const r = await sugerir.mutateAsync({
        obra_id: obraId,
        instrucoes: instrucao,
        plano_atual: comRefino ? planoAnterior : undefined,
        historico_chat: novasMsgs.length > 0 ? novasMsgs : undefined
      })
      // Diff só faz sentido num refino (há plano anterior para comparar).
      if (comRefino) {
        const d = diffPlanos(planoAnterior, r.grupos)
        setDiff(d)
        if (diffTimer.current) clearTimeout(diffTimer.current)
        diffTimer.current = setTimeout(() => setDiff(null), DIFF_TTL_MS)
      }
      setResp(r)
      // Mantém os grupos JÁ aplicados visíveis; substitui os pendentes pela nova proposta.
      setGrupos((prev) => [...prev.filter((g) => g.aplicado), ...r.grupos.map(toVM)])
      setNaoAgrupados(r.nao_agrupados)
      const fala =
        r.resposta_agente?.trim() ||
        `Proposta: ${r.grupos.length} grupo(s), ${r.nao_agrupados.length} sem grupo.`
      setMensagens([...novasMsgs, { role: 'agente', texto: fala }])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao gerar proposta'
      toast.error(msg)
      if (instrucao) {
        setMensagens([...novasMsgs, { role: 'agente', texto: `Não consegui processar: ${msg}` }])
      }
    }
  }

  // ── Edição de grupos ───────────────────────────────────────────────────────
  // Filhos que servem de referência de quantidade, conforme o modo (sempre só
  // os que ainda existem no grupo). É a fonte de verdade para computeQtd e apply.
  const refFilhos = (g: GrupoVM): string[] => {
    if (g.qtd_ref_modo === 'manual') return []
    const validos = g.qtdRefFilhos.filter((id) => g.receitas.some((r) => r.id === id))
    if (g.qtd_ref_modo === 'heranca') {
      const alvo = validos[0] ?? g.receitas[0]?.id
      return alvo ? [alvo] : []
    }
    return validos // soma_filhos: subconjunto marcado
  }

  const computeQtd = (g: GrupoVM): number => {
    if (g.qtd_ref_modo === 'manual') return parseBR(g.qtdManual).toNumber() || 0
    const filhos = refFilhos(g)
    if (g.qtd_ref_modo === 'heranca') return qtdPorReceita.get(filhos[0]) ?? 0
    return filhos.reduce((acc, id) => acc + (qtdPorReceita.get(id) ?? 0), 0)
  }

  const patchGrupo = (key: string, patch: Partial<GrupoVM>): void => {
    setGrupos((prev) => prev.map((g) => (g.key === key ? { ...g, ...patch, editado: true } : g)))
  }

  // Troca o modo de qtd normalizando a seleção de filhos:
  //  - soma_filhos → marca todos; heranca → mantém o atual (ou o 1º).
  const mudarModo = (key: string, modo: QtdRefModoAgente): void => {
    setGrupos((prev) =>
      prev.map((g) => {
        if (g.key !== key) return g
        let filhos = g.qtdRefFilhos
        if (modo === 'soma_filhos') {
          filhos = g.receitas.map((r) => r.id)
        } else if (modo === 'heranca') {
          const atual = g.qtdRefFilhos.find((id) => g.receitas.some((r) => r.id === id))
          const alvo = atual ?? g.receitas[0]?.id
          filhos = alvo ? [alvo] : []
        }
        return { ...g, qtd_ref_modo: modo, qtdRefFilhos: filhos, editado: true }
      })
    )
  }

  const escolherHeranca = (key: string, receitaId: string): void => {
    patchGrupo(key, { qtdRefFilhos: [receitaId] })
  }

  const toggleSomaFilho = (key: string, receitaId: string): void => {
    setGrupos((prev) =>
      prev.map((g) => {
        if (g.key !== key) return g
        const tem = g.qtdRefFilhos.includes(receitaId)
        const filhos = tem
          ? g.qtdRefFilhos.filter((id) => id !== receitaId)
          : [...g.qtdRefFilhos, receitaId]
        return { ...g, qtdRefFilhos: filhos, editado: true }
      })
    )
  }

  const removerReceita = (key: string, receitaId: string): void => {
    setGrupos((prev) =>
      prev.map((g) => {
        if (g.key !== key) return g
        const removida = g.receitas.find((r) => r.id === receitaId)
        if (removida) {
          setNaoAgrupados((na) => [
            ...na,
            {
              receita_id: removida.id,
              codigo: removida.codigo,
              descricao: removida.descricao,
              motivo: 'Removida do grupo pelo usuário.'
            }
          ])
        }
        return {
          ...g,
          receitas: g.receitas.filter((r) => r.id !== receitaId),
          qtdRefFilhos: g.qtdRefFilhos.filter((id) => id !== receitaId),
          editado: true
        }
      })
    )
  }

  const mudarServico = (key: string, servicoId: string): void => {
    const s = servicosFolha.find((x) => x.id === servicoId)
    if (!s) return
    patchGrupo(key, {
      servico_id: s.id,
      servico_codigo: s.codigo,
      servico_nome: s.nome,
      servico_unidade: s.unidade
    })
  }

  const feedbackRows = (
    g: GrupoVM,
    acao: FeedbackAgrupamentoInput['acao']
  ): FeedbackAgrupamentoInput[] =>
    g.receitas.map((r) => ({
      obra_id: obraId,
      receita_codigo: r.codigo,
      receita_descricao: r.descricao,
      servico_id: g.servico_id,
      servico_codigo: g.servico_codigo,
      servico_nome: g.servico_nome,
      acao,
      contexto: { papel: r.papel, grupo: g.descricao, qtd_modo: g.qtd_ref_modo },
      origem: 'agente'
    }))

  const aplicarGrupo = async (g: GrupoVM): Promise<boolean> => {
    if (g.receitas.length === 0) {
      toast.error('Grupo sem receitas.')
      return false
    }
    const qtd = computeQtd(g)
    if (qtd <= 0) {
      toast.error(`"${g.descricao}": quantidade de referência deve ser > 0.`)
      return false
    }
    const ids = g.receitas.map((r) => r.id)
    try {
      await agrupar.mutateAsync({
        obra_id: obraId,
        descricao: g.descricao,
        servico_id: g.servico_id,
        cpu_snapshot_id: null,
        indireto_id: null,
        unidade_referencia: g.servico_unidade ?? 'un',
        qtd_ref_modo: g.qtd_ref_modo,
        quantidade_referencia: qtd,
        qtd_ref_filhos: refFilhos(g),
        receitas_ids: ids
      })
      setGrupos((prev) => prev.map((x) => (x.key === g.key ? { ...x, aplicado: true } : x)))
      void feedback.mutateAsync(feedbackRows(g, g.editado ? 'corrigido' : 'aceito')).catch(() => {})
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Falha ao aplicar "${g.descricao}"`)
      return false
    }
  }

  const handleAplicarGrupo = async (g: GrupoVM): Promise<void> => {
    setApplyingKey(g.key)
    const ok = await aplicarGrupo(g)
    setApplyingKey(null)
    if (ok) toast.success(`Grupo "${g.descricao}" criado.`)
  }

  const handleAplicarTodos = async (): Promise<void> => {
    setApplyingAll(true)
    let ok = 0
    for (const g of grupos.filter((x) => !x.aplicado)) {
      setApplyingKey(g.key)
      const r = await aplicarGrupo(g)
      if (r) ok++
    }
    setApplyingKey(null)
    setApplyingAll(false)
    toast.success(`${ok} grupo(s) aplicado(s).`)
  }

  const rejeitarGrupo = (g: GrupoVM): void => {
    void feedback.mutateAsync(feedbackRows(g, 'rejeitado')).catch(() => {})
    setNaoAgrupados((na) => [
      ...na,
      ...g.receitas.map((r) => ({
        receita_id: r.id,
        codigo: r.codigo,
        descricao: r.descricao,
        motivo: 'Grupo rejeitado pelo usuário.'
      }))
    ])
    setGrupos((prev) => prev.filter((x) => x.key !== g.key))
  }

  const pendentes = grupos.filter((g) => !g.aplicado).length

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      size="full"
      // Só bloqueia o fechar durante o "Aplicar todos" (loop que grava no banco).
      // Durante a geração/refino (job em background) ou no idle, o X fecha normal —
      // fechar só abandona o polling local, sem efeito colateral no servidor.
      disableDismiss={applyingAll}
    >
      <DialogHeader className="shrink-0 pr-10">
        <DialogTitle>
          <span className="inline-flex items-center gap-2">
            <Sparkles size={15} className="text-accent" />
            Agente de Agrupamento
          </span>
        </DialogTitle>
        <DialogDescription>
          Proponha, converse e ajuste os agrupamentos até a qualidade desejada. O agente aprende com
          suas correções.
        </DialogDescription>
      </DialogHeader>

      {/* Corpo — 3 painéis */}
      <div className="flex-1 min-h-0 flex">
        <div style={{ width: leftW }} className="shrink-0 border-r border-border overflow-hidden">
          <PainelCobertura
            servicosFolha={servicosFolha}
            grupos={grupos}
            totalReceitas={totalReceitas}
            vendaPorReceita={vendaPorReceita}
            totalVenda={totalVenda}
            servicoSelecionadoId={servicoSelecionadoId}
            onSelecionar={setServicoSelecionadoId}
          />
        </div>
        <Splitter width={leftW} min={220} max={460} side="left" onChange={setLeftW} />

        <div className="flex-1 min-w-0 overflow-hidden">
          <PainelProposta
            grupos={grupos}
            naoAgrupados={naoAgrupados}
            avisos={resp?.avisos ?? []}
            servicosFolha={servicosFolha}
            custoPorServico={custoPorServico}
            qtdPorReceita={qtdPorReceita}
            omissosTree={omissosTree}
            diff={diff}
            servicoSelecionadoId={servicoSelecionadoId}
            hasResp={resp != null}
            trabalhando={trabalhando}
            busy={busy}
            applyingKey={applyingKey}
            computeQtd={computeQtd}
            onGerarInicial={() => void enviar(undefined)}
            onPatchGrupo={patchGrupo}
            onMudarModo={mudarModo}
            onEscolherHeranca={escolherHeranca}
            onToggleSomaFilho={toggleSomaFilho}
            onRemoverReceita={removerReceita}
            onMudarServico={mudarServico}
            onAplicarGrupo={(g) => void handleAplicarGrupo(g)}
            onRejeitarGrupo={rejeitarGrupo}
          />
        </div>
        <Splitter width={rightW} min={300} max={520} side="right" onChange={setRightW} />

        <div style={{ width: rightW }} className="shrink-0 border-l border-border overflow-hidden">
          <PainelChat
            mensagens={mensagens}
            trabalhando={trabalhando}
            hasResp={resp != null}
            onEnviar={(t) => void enviar(t)}
          />
        </div>
      </div>

      <DialogFooter className="shrink-0">
        {resp?._meta ? (
          <span className="text-2xs font-mono text-text-dim mr-auto">
            {resp._meta.modelo} · {resp._meta.exemplos_fewshot} exemplo(s) aprendidos
          </span>
        ) : null}
        {pendentes > 0 ? (
          <Button
            variant="default"
            size="md"
            onClick={() => void handleAplicarTodos()}
            disabled={busy}
          >
            {applyingAll ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Aplicar todos ({pendentes})
          </Button>
        ) : null}
      </DialogFooter>
    </Dialog>
  )
}

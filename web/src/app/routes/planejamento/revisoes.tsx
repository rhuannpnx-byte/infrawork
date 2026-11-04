import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import {
  AlertTriangle,
  CopyPlus,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  RotateCcw,
  Star,
  StarOff,
  Trash2
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { RequireObra } from '@/components/layout/RequireObra'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/IconButton'
import { Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/dialog'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import {
  usePlanejamentos,
  useDeletePlanejamento,
  useCopiarPlanejamento,
  useCadeiaTrava,
  useLbPremissasDiff,
  useMarcarVigente,
  useDesmarcarVigente,
  useRestaurarLinhaBase,
  type PremissasDiff
} from '@/features/planejamento/hooks/planejamentos'
import { NewPlanejamentoDialog } from '@/features/planejamento/modals/NewPlanejamentoDialog'
import { PromoverBaselineDialog } from '@/features/planejamento/modals/PromoverBaselineDialog'
import { fmtDataBR } from '@/features/planejamento/lib/dates'
import { fmtBRL, fmtQtd } from '@/lib/money'
import type { Planejamento } from '@/types/planejamento'
import { useConfirm } from '@/components/modals/ConfirmDialog'

const MAX_LB = 20

export function PlanejamentoRevisoesPage(): ReactNode {
  return (
    <RequireObra pageTitle="Planos e linhas de base">
      <PlanosInner />
    </RequireObra>
  )
}

function PlanosInner(): ReactNode {
  const navigate = useNavigate()
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const readOnly = role === 'apoio' || role === 'cliente'

  const { data: planos = [] } = usePlanejamentos(obraId)
  const { data: trava } = useCadeiaTrava(obraId)
  const del = useDeletePlanejamento()
  const copiar = useCopiarPlanejamento()
  const confirm = useConfirm()

  const [novoOpen, setNovoOpen] = useState(false)
  const [promoverPlan, setPromoverPlan] = useState<Planejamento | null>(null)

  const edicao = planos.find((p) => !p.is_baseline) ?? null
  const lbs = planos.filter((p) => p.is_baseline)
  const vigente = lbs.find((p) => p.vigente) ?? null

  const excluir = async (p: Planejamento): Promise<void> => {
    const ok = await confirm({
      title: `Excluir "${p.nome}"?`,
      description: p.is_baseline
        ? 'Sem volta. A linha de base e suas premissas são removidas.'
        : 'Sem volta. As tarefas e dependências do plano em edição são removidas.',
      confirmLabel: 'Excluir',
      variant: 'danger'
    })
    if (!ok) return
    try {
      await del.mutateAsync({ id: p.id, obra_id: obraId })
      toast.success('Excluído.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao excluir')
    }
  }

  const editarAPartirDe = async (p: Planejamento): Promise<void> => {
    const nome = prompt(
      `Nome do novo plano em edição (a partir de "${p.nome}"):`,
      `${p.nome} — rev.`
    )
    if (!nome?.trim()) return
    try {
      const r = await copiar.mutateAsync({
        origem_id: p.id,
        nome_novo: nome.trim(),
        obra_id: obraId
      })
      toast.success(
        r.tarefas_ajustadas > 0
          ? `Plano em edição criado — ${r.tarefas_ajustadas} tarefa(s) ajustada(s) à quantidade atual do orçamento.`
          : 'Plano em edição criado.'
      )
      void navigate({ to: '/planejamento/cronograma' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao copiar')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Planos e linhas de base"
        subtitle={`${scope.obra?.nome ?? ''} — 1 plano em edição, até ${MAX_LB} linhas de base, 1 vigente.`}
        actions={
          !readOnly && !edicao ? (
            <Button size="sm" variant="default" onClick={() => setNovoOpen(true)}>
              <Plus size={11} /> Novo plano em edição
            </Button>
          ) : null
        }
      />
      <div className="flex-1 overflow-auto p-5 space-y-5">
        <div
          className={
            'flex items-start gap-2 rounded border px-3 py-2 text-xs ' +
            (trava
              ? 'border-warn/40 bg-warn/10 text-warn'
              : 'border-success/30 bg-success/10 text-success')
          }
        >
          {trava ? (
            <Lock size={13} className="mt-px shrink-0" />
          ) : (
            <LockOpen size={13} className="mt-px shrink-0" />
          )}
          <span>
            {trava ? (
              <>
                <strong>Orçamento, composições e recursos travados:</strong> {trava}.
              </>
            ) : (
              <>
                <strong>Orçamento, composições e recursos editáveis</strong> — as mudanças refletem
                no plano em edição; linhas de base não mudam.
              </>
            )}
          </span>
        </div>

        <section>
          <h2 className="text-2xs font-mono uppercase tracking-wider text-text-dim mb-2">
            Plano em edição
          </h2>
          {edicao ? (
            <div className="rounded border border-accent-line bg-bg-panel px-3 py-2.5 flex items-center gap-3">
              <Pencil size={13} className="text-accent shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text truncate">{edicao.nome}</div>
                <div className="text-2xs font-mono text-text-dim">
                  início {fmtDataBR(edicao.data_referencia_inicio)} · criado{' '}
                  {fmtDataBR(edicao.created_at.slice(0, 10))}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate({ to: '/planejamento/cronograma' })}
              >
                Abrir cronograma
              </Button>
              {!readOnly ? (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setPromoverPlan(edicao)}
                    disabled={lbs.length >= MAX_LB}
                    title={lbs.length >= MAX_LB ? `Limite de ${MAX_LB} linhas de base` : undefined}
                  >
                    <Lock size={11} /> Travar como linha de base
                  </Button>
                  <IconButton
                    size="sm"
                    variant="danger"
                    aria-label="Excluir plano em edição"
                    title="Excluir plano em edição"
                    onClick={() => void excluir(edicao)}
                  >
                    <Trash2 size={11} />
                  </IconButton>
                </>
              ) : null}
            </div>
          ) : (
            <div className="rounded border border-dashed border-border px-3 py-3 text-xs text-text-muted">
              Nenhum plano em edição. Crie um novo ou use <CopyPlus size={10} className="inline" />{' '}
              numa linha de base para replanejar a partir dela.
            </div>
          )}
        </section>

        <section>
          <h2 className="text-2xs font-mono uppercase tracking-wider text-text-dim mb-2">
            Linhas de base ({lbs.length}/{MAX_LB})
          </h2>
          {lbs.length === 0 ? (
            <EmptyState
              icon="history"
              title="Nenhuma linha de base"
              description="Trave o plano em edição como linha de base para ter a régua do acompanhamento."
            />
          ) : (
            <div className="rounded border border-border bg-bg-panel overflow-hidden">
              <table className="w-full text-xs">
                <thead className="text-text-dim font-mono uppercase text-2xs bg-bg">
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-2">Linha de base</th>
                    <th className="text-left px-3 py-2">Início</th>
                    <th className="text-left px-3 py-2">Travada em</th>
                    <th className="text-left px-3 py-2">Premissas</th>
                    <th className="px-3 py-2 w-44" />
                  </tr>
                </thead>
                <tbody>
                  {lbs.map((p) => (
                    <LinhaBaseRow
                      key={p.id}
                      p={p}
                      obraId={obraId}
                      readOnly={readOnly}
                      provisoria={!vigente && !!p.vigente_em && p.id === referenciaProvisoria(lbs)}
                      podeCriarEdicao={!edicao}
                      onAbrir={() =>
                        navigate({ to: '/planejamento/revisoes/$id', params: { id: p.id } })
                      }
                      onEditarAPartir={() => void editarAPartirDe(p)}
                      onExcluir={() => void excluir(p)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <NewPlanejamentoDialog
        open={novoOpen}
        onOpenChange={setNovoOpen}
        obraId={obraId}
        onCreated={() => navigate({ to: '/planejamento/cronograma' })}
      />
      <PromoverBaselineDialog
        open={!!promoverPlan}
        onOpenChange={(o) => !o && setPromoverPlan(null)}
        planejamento={promoverPlan}
        obraId={obraId}
        temVigente={!!vigente}
        totalLinhasBase={lbs.length}
      />
    </div>
  )
}

/** Sem vigente, a última LB que foi vigente é a régua provisória. */
function referenciaProvisoria(lbs: Planejamento[]): string | null {
  const com = lbs
    .filter((p) => p.vigente_em)
    .sort((a, b) => (b.vigente_em! > a.vigente_em! ? 1 : -1))
  return com[0]?.id ?? null
}

function LinhaBaseRow({
  p,
  obraId,
  readOnly,
  provisoria,
  podeCriarEdicao,
  onAbrir,
  onEditarAPartir,
  onExcluir
}: {
  p: Planejamento
  obraId: string
  readOnly: boolean
  provisoria: boolean
  podeCriarEdicao: boolean
  onAbrir: () => void
  onEditarAPartir: () => void
  onExcluir: () => void
}): ReactNode {
  const { data: diff } = useLbPremissasDiff(p.id)
  const marcar = useMarcarVigente()
  const desmarcar = useDesmarcarVigente()
  const restaurar = useRestaurarLinhaBase()
  const confirm = useConfirm()
  const [verDiff, setVerDiff] = useState(false)
  const mudou = !!diff?.mudou

  const onMarcar = async (): Promise<void> => {
    const ok = await confirm({
      title: `Tornar "${p.nome}" a linha de base vigente?`,
      description:
        'Ela passa a ser a régua do acompanhamento. Enquanto houver vigente, orçamento, composições e recursos ficam travados (aditivos e reajustes continuam permitidos).',
      confirmLabel: 'Tornar vigente'
    })
    if (!ok) return
    try {
      await marcar.mutateAsync({ planejamento_id: p.id, obra_id: obraId })
      toast.success('Linha de base vigente atualizada.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha')
    }
  }

  const onDesmarcar = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Desmarcar a vigente para replanejar?',
      description:
        'O orçamento, as composições e os recursos voltam a ser editáveis pelo plano em edição. Até marcar outra vigente, o acompanhamento segue usando esta como referência provisória.',
      confirmLabel: 'Desmarcar'
    })
    if (!ok) return
    try {
      await desmarcar.mutateAsync({ obra_id: obraId })
      toast.success('Sem vigente — replanejamento liberado.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha')
    }
  }

  const onRestaurar = async (): Promise<void> => {
    const nome = prompt(
      `Nome da nova linha de base (cópia de "${p.nome}" com as premissas atuais):`,
      `${p.nome} — restaurada`
    )
    if (!nome?.trim()) return
    try {
      const r = await restaurar.mutateAsync({
        planejamento_id: p.id,
        nome_novo: nome.trim(),
        obra_id: obraId
      })
      toast.success(
        `Nova linha de base criada${r.tarefas_ajustadas > 0 ? ` (${r.tarefas_ajustadas} tarefa(s) ajustada(s) ao orçamento)` : ''}. "${p.nome}" ficou intacta.`
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao restaurar')
    }
  }

  return (
    <tr className="border-b border-border/40 hover:bg-bg-hover">
      <td className="px-3 py-2">
        <button type="button" className="text-left hover:text-accent" onClick={onAbrir}>
          <span className="inline-flex items-center gap-1.5">
            {p.vigente ? <Star size={10} className="text-amber-400 fill-amber-400" /> : null}
            <span className={p.vigente ? 'text-accent font-semibold' : 'text-text'}>{p.nome}</span>
          </span>
        </button>
        <div className="mt-0.5 flex gap-1">
          {p.vigente ? <Badge variant="accent">vigente</Badge> : null}
          {provisoria ? <Badge variant="warn">referência provisória</Badge> : null}
        </div>
      </td>
      <td className="px-3 py-2 font-mono text-text-muted">{fmtDataBR(p.data_referencia_inicio)}</td>
      <td className="px-3 py-2 font-mono text-text-muted">
        {p.travada_em ? fmtDataBR(p.travada_em.slice(0, 10)) : '—'}
      </td>
      <td className="px-3 py-2">
        {!diff ? (
          <span className="text-text-dim font-mono">…</span>
        ) : mudou ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-warn hover:underline font-mono text-2xs"
            onClick={() => setVerDiff(true)}
          >
            <AlertTriangle size={11} /> premissas mudaram
          </button>
        ) : (
          <span className="text-success font-mono text-2xs">em dia</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {!readOnly ? (
          <div className="inline-flex items-center gap-1">
            {p.vigente ? (
              <IconButton
                size="sm"
                aria-label="Desmarcar vigente"
                title="Desmarcar vigente (replanejar)"
                onClick={() => void onDesmarcar()}
              >
                <StarOff size={11} />
              </IconButton>
            ) : mudou ? null : (
              <IconButton
                size="sm"
                aria-label="Tornar vigente"
                title="Tornar vigente"
                onClick={() => void onMarcar()}
                className="hover:text-warn"
              >
                <Star size={11} />
              </IconButton>
            )}
            {mudou ? (
              <IconButton
                size="sm"
                aria-label="Restaurar como nova linha de base"
                title="Restaurar como nova linha de base (com as premissas atuais)"
                onClick={() => void onRestaurar()}
                disabled={restaurar.isPending || !podeCriarEdicao}
              >
                <RotateCcw size={11} />
              </IconButton>
            ) : null}
            <IconButton
              size="sm"
              aria-label="Criar plano em edição a partir desta"
              title={
                podeCriarEdicao
                  ? 'Criar plano em edição a partir desta'
                  : 'Já existe um plano em edição'
              }
              onClick={onEditarAPartir}
              disabled={!podeCriarEdicao}
            >
              <CopyPlus size={11} />
            </IconButton>
            {!p.vigente ? (
              <IconButton
                size="sm"
                variant="danger"
                aria-label="Excluir linha de base"
                title="Excluir"
                onClick={onExcluir}
              >
                <Trash2 size={11} />
              </IconButton>
            ) : null}
          </div>
        ) : null}
        {diff && verDiff ? (
          <PremissasDialog nome={p.nome} diff={diff} onClose={() => setVerDiff(false)} />
        ) : null}
      </td>
    </tr>
  )
}

function par(v: [number, number] | null, fmt: (n: number) => string): ReactNode {
  if (!v) return <span className="text-text-dim">—</span>
  return (
    <span>
      {fmt(Number(v[0] ?? 0))} → <strong className="text-warn">{fmt(Number(v[1] ?? 0))}</strong>
    </span>
  )
}

function PremissasDialog({
  nome,
  diff,
  onClose
}: {
  nome: string
  diff: PremissasDiff
  onClose: () => void
}): ReactNode {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="lg">
      <DialogHeader>
        <DialogTitle>Premissas que mudaram — {nome}</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3 text-left">
        <p className="text-xs text-text-muted">
          A linha de base continua com os valores da época em que foi travada. Para usar as
          premissas atuais, restaure-a como nova linha de base (a original fica intacta).
        </p>
        {diff.calendario ? (
          <div className="text-xs text-warn">
            Calendário da obra mudou (dias úteis, feriados ou fatores de produtividade).
          </div>
        ) : null}
        {diff.itens.length > 0 ? (
          <div className="rounded border border-border overflow-auto max-h-[50vh]">
            <table className="w-full text-2xs font-mono">
              <thead className="text-text-dim bg-bg sticky top-0">
                <tr className="border-b border-border">
                  <th className="text-left px-2 py-1">Serviço</th>
                  <th className="text-right px-2 py-1">Quantidade</th>
                  <th className="text-right px-2 py-1">Venda</th>
                  <th className="text-right px-2 py-1">Custo unit.</th>
                  <th className="text-right px-2 py-1">Produção/dia</th>
                </tr>
              </thead>
              <tbody>
                {diff.itens.map((it) => (
                  <tr key={it.item_orcamentario_id} className="border-b border-border/40">
                    <td className="px-2 py-1 text-text">
                      {it.codigo} · {it.descricao}
                    </td>
                    <td className="px-2 py-1 text-right">{par(it.quantidade, fmtQtd)}</td>
                    <td className="px-2 py-1 text-right">{par(it.venda, fmtBRL)}</td>
                    <td className="px-2 py-1 text-right">{par(it.custo_unit, fmtBRL)}</td>
                    <td className="px-2 py-1 text-right">{par(it.producao, fmtQtd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

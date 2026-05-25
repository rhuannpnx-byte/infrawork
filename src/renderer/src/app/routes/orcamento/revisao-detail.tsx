import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useParams, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, GitBranch, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { useDeleteRevisao, useRevisao } from '@/features/orcamento/hooks/revisoes'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { RevisaoStatusBadge } from '@/features/orcamento/components/RevisaoStatusBadge'
import { AnexosList } from '@/features/orcamento/components/AnexosList'
import { TransicionarStatusDialog } from '@/features/orcamento/modals/TransicionarStatusDialog'
import { fmtBRL, fmtPct2 } from '@/lib/money'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

interface SnapshotItem {
  id: string
  parent_id: string | null
  codigo: string
  descricao: string
  unidade: string | null
  quantidade: number | null
  venda_unitaria: number | null
  bdi_perc: number | null
  custo_total_calc: number
  venda_total_calc: number
  lucratividade_perc_calc: number | null
}

interface SnapshotIndireto {
  id: string
  codigo: string
  descricao: string
  tipo: string
  valor_total: number
  distribuicao_perc: number
}

interface SnapshotPayload {
  snapshot_em: string
  obra?: Record<string, unknown>
  itens: SnapshotItem[]
  indireto: SnapshotIndireto[]
  cpu_snapshots: unknown[]
  totais: { custo_direto: number; venda_total: number }
}

export function RevisaoDetailPage(): ReactNode {
  return (
    <RequireObra pageTitle="Revisão">
      <RevisaoDetail />
    </RequireObra>
  )
}

function RevisaoDetail(): ReactNode {
  const { id } = useParams({ from: '/orcamento/obra/revisoes/$id' })
  const navigate = useNavigate()
  const scope = useCurrentScope()
  const role = useAuthStore((s) => s.profile?.role)
  const obraId = scope.obraId!

  const { data: revisao, isLoading, error } = useRevisao(id)
  const del = useDeleteRevisao()
  const confirm = useConfirm()
  const [transOpen, setTransOpen] = useState(false)

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Revisão" />
        <div className="flex-1 flex items-center justify-center text-xs text-text-muted font-mono">
          Carregando…
        </div>
      </div>
    )
  }
  if (error || !revisao) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Revisão" />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="alert-triangle"
            title="Revisão não encontrada"
            description={error?.message ?? ''}
            action={
              <Button
                variant="default"
                size="sm"
                onClick={() => navigate({ to: '/orcamento/obra/revisoes' })}
              >
                Voltar
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  const payload = revisao.snapshot as SnapshotPayload
  const itens = payload?.itens ?? []
  const indireto = payload?.indireto ?? []
  const raizes = itens.filter((it) => it.parent_id === null)
  const podeTransicionar = role === 'god' || role === 'adm' || role === 'engenheiro'
  const podeDeletar = (role === 'god' || role === 'adm') && revisao.status !== 'homologada'

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={`Revisão v${revisao.versao}${revisao.rotulo ? ` — ${revisao.rotulo}` : ''}`}
        subtitle={`${scope.obra?.nome ?? ''} · snapshot de ${formatDate(revisao.criada_em)}`}
        actions={
          <div className="flex items-center gap-2">
            <RevisaoStatusBadge status={revisao.status} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate({ to: '/orcamento/obra/revisoes' })}
            >
              <ArrowLeft size={11} /> Voltar
            </Button>
            {podeTransicionar &&
            revisao.status !== 'homologada' &&
            revisao.status !== 'cancelada' ? (
              <Button variant="secondary" size="sm" onClick={() => setTransOpen(true)}>
                <GitBranch size={11} /> Transicionar status
              </Button>
            ) : null}
            {podeDeletar ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  const ok = await confirm({
                    title: `Excluir revisão v${revisao.versao}?`,
                    description: 'Esta ação é definitiva. A revisão e seus snapshots serão removidos.',
                    confirmLabel: 'Excluir',
                    variant: 'danger'
                  })
                  if (!ok) return
                  try {
                    await del.mutateAsync({ id: revisao.id, obra_id: revisao.obra_id })
                    toast.success('Revisão excluída.')
                    navigate({ to: '/orcamento/obra/revisoes' })
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Falha ao excluir')
                  }
                }}
                disabled={del.isPending}
              >
                <Trash2 size={11} /> Excluir
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-5 space-y-4">
        {/* Resumo */}
        <div className="grid grid-cols-4 gap-3">
          <ResumoCard label="Venda total" value={fmtBRL(revisao.venda_total)} />
          <ResumoCard label="Custo total" value={fmtBRL(revisao.custo_total)} />
          <ResumoCard
            label="Lucratividade"
            value={revisao.lucratividade_perc !== null ? fmtPct2(revisao.lucratividade_perc) : '—'}
            tone={
              revisao.lucratividade_perc !== null && revisao.lucratividade_perc < 0
                ? 'danger'
                : revisao.lucratividade_perc !== null && revisao.lucratividade_perc < 0.1
                  ? 'warn'
                  : 'success'
            }
          />
          <ResumoCard
            label="Itens (raízes)"
            value={String(raizes.length)}
            hint={`${itens.length} itens total · ${indireto.length} indireto(s)`}
          />
        </div>

        {/* Carimbos */}
        <div className="rounded border border-border bg-bg-panel p-4">
          <h3 className="text-2xs font-mono uppercase tracking-wider text-text-muted mb-2">
            Carimbos
          </h3>
          <div className="grid grid-cols-4 gap-3 text-2xs font-mono">
            <Carimbo label="Criada por" id={revisao.criada_por} em={revisao.criada_em} />
            <Carimbo label="Aprovada por" id={revisao.aprovada_por} em={revisao.aprovada_em} />
            <Carimbo
              label="Homologada por"
              id={revisao.homologada_por}
              em={revisao.homologada_em}
            />
            <Carimbo label="Cancelada por" id={revisao.cancelada_por} em={revisao.cancelada_em} />
          </div>
          {revisao.observacao ? (
            <div className="mt-3 text-xs text-text-muted">
              <span className="text-text-dim font-mono uppercase text-2xs mr-1">Obs:</span>
              {revisao.observacao}
            </div>
          ) : null}
        </div>

        {/* Planilha Orçamentária — raízes (do snapshot) */}
        <div className="rounded border border-border bg-bg-panel">
          <div className="px-4 py-2 border-b border-border bg-bg-elevated">
            <h3 className="text-2xs font-mono uppercase tracking-wider text-text-muted">
              Planilha Orçamentária — raízes (snapshot)
            </h3>
          </div>
          <table className="w-full text-xs font-mono">
            <thead className="text-2xs text-text-dim uppercase">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2">Código</th>
                <th className="text-left px-3 py-2">Descrição</th>
                <th className="text-right px-3 py-2">Venda</th>
                <th className="text-right px-3 py-2">Custo</th>
                <th className="text-right px-3 py-2">Lucr.%</th>
              </tr>
            </thead>
            <tbody>
              {raizes.map((r) => (
                <tr key={r.id} className="border-b border-border/40">
                  <td className="px-3 py-2 text-text-dim">{r.codigo}</td>
                  <td className="px-3 py-2 text-text">{r.descricao}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtBRL(r.venda_total_calc)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-muted">
                    {fmtBRL(r.custo_total_calc)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.lucratividade_perc_calc !== null ? fmtPct2(r.lucratividade_perc_calc) : '—'}
                  </td>
                </tr>
              ))}
              {raizes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-text-muted">
                    Snapshot sem raízes.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Anexos da revisão */}
        <div className="rounded border border-border bg-bg-panel p-4">
          <AnexosList
            obraId={obraId}
            escopo="revisao"
            escopoId={revisao.id}
            podeEditar={podeTransicionar}
          />
        </div>
      </div>

      <TransicionarStatusDialog open={transOpen} onOpenChange={setTransOpen} revisao={revisao} />
    </div>
  )
}

function ResumoCard({
  label,
  value,
  hint,
  tone
}: {
  label: string
  value: string
  hint?: string
  tone?: 'success' | 'warn' | 'danger'
}): ReactNode {
  return (
    <div
      className={cn(
        'rounded border p-3',
        tone === 'danger'
          ? 'border-danger/40 bg-danger/5'
          : tone === 'warn'
            ? 'border-warn/40 bg-warn/5'
            : tone === 'success'
              ? 'border-success/40 bg-success/5'
              : 'border-border bg-bg-panel'
      )}
    >
      <div className="text-2xs font-mono uppercase tracking-wider text-text-dim mb-1">{label}</div>
      <div className="text-md font-mono text-text tabular-nums">{value}</div>
      {hint ? <div className="text-2xs text-text-dim font-mono mt-0.5">{hint}</div> : null}
    </div>
  )
}

function Carimbo({
  label,
  id,
  em
}: {
  label: string
  id: string | null
  em: string | null
}): ReactNode {
  return (
    <div>
      <div className="text-text-dim uppercase tracking-wider">{label}</div>
      <div className="text-text-muted mt-0.5">{id ? id.slice(0, 8) + '…' : '—'}</div>
      <div className="text-text-dim">{em ? formatDate(em) : '—'}</div>
    </div>
  )
}

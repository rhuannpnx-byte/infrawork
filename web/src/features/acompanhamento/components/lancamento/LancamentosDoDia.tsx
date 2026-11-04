import { useMemo, type ReactNode } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Camera, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { PulseBlock } from '@/components/ui/PulseBlock'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { useAuthStore } from '@/stores/auth-store'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ProducaoEnriquecida } from '@/types/acompanhamento'
import { useDeleteLancamento, useLancamentosDia } from '../../hooks/lancamento'
import { rotuloLocalProducao } from '../../lib/local-producao'

interface Props {
  obraId: string
  data: string
  onEditar?: (p: ProducaoEnriquecida) => void
  compacto?: boolean
}

export function LancamentosDoDia({ obraId, data, onEditar, compacto = false }: Props): ReactNode {
  const { data: rows = [], isLoading } = useLancamentosDia(obraId, data)
  const del = useDeleteLancamento()
  const confirm = useConfirm()
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const uid = useAuthStore((s) => s.profile?.id ?? null)

  const podeEditar = (p: ProducaoEnriquecida): boolean =>
    role === 'god' ||
    role === 'adm' ||
    role === 'engenheiro' ||
    (role === 'apoio' && p.criado_por === uid)

  const duplicados = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of rows) {
      const k = `${p.item_orcamentario_id ?? ''}|${p.equipe_id ?? ''}`
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return new Set([...m.entries()].filter(([, n]) => n > 1).map(([k]) => k))
  }, [rows])

  const total = rows.length
  const fotos = rows.reduce((a, p) => a + Number(p.fotos_count ?? 0), 0)

  const excluir = async (p: ProducaoEnriquecida): Promise<void> => {
    const ok = await confirm({
      title: 'Excluir este lançamento?',
      description: `${p.servico_display_nome} · ${formatNumber(Number(p.qtd ?? 0), 2)} ${p.unidade ?? ''}${p.equipe_display_nome ? ` · ${p.equipe_display_nome}` : ''}`,
      confirmLabel: 'Excluir',
      variant: 'danger'
    })
    if (!ok) return
    try {
      await del.mutateAsync({ id: p.id })
      toast.success('Lançamento excluído.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao excluir')
    }
  }

  return (
    <div className={cn('flex flex-col', compacto ? 'p-4' : 'p-5')}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-text-muted">
          <span className="text-text font-semibold">{total}</span> lançamento
          {total === 1 ? '' : 's'} em {fmtBR(data)}
          {fotos > 0 ? (
            <span className="ml-2 inline-flex items-center gap-1 text-text-dim">
              <Camera size={10} /> {fotos}
            </span>
          ) : null}
        </div>
      </div>

      {duplicados.size > 0 ? (
        <div className="mb-3 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            Há serviço com mais de um lançamento para a mesma equipe neste dia. Confira se não é
            duplicidade.
          </span>
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <PulseBlock key={i} h={64} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-2xs font-mono text-text-dim py-8 text-center">
          Nenhum lançamento neste dia.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((p) => {
            const dup = duplicados.has(`${p.item_orcamentario_id ?? ''}|${p.equipe_id ?? ''}`)
            return (
              <div
                key={p.id}
                className={cn(
                  'rounded border bg-bg-panel p-3 flex gap-3',
                  dup ? 'border-warn/50' : 'border-border'
                )}
              >
                <span
                  className="w-1 rounded-full shrink-0"
                  style={{ background: p.equipe_display_cor ?? 'var(--border-strong)' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm text-text truncate" title={p.servico_display_nome}>
                        {p.servico_grupo_codigo ? (
                          <span className="font-mono text-2xs text-text-dim mr-1.5">
                            {p.servico_grupo_codigo}
                          </span>
                        ) : null}
                        {p.servico_display_nome}
                      </div>
                      <div className="text-2xs font-mono text-text-dim truncate mt-0.5">
                        {p.equipe_display_nome ?? 'sem equipe'}
                        {p.encarregado_display_nome ? ` · ${p.encarregado_display_nome}` : ''}
                        {p.frente_raw ? ` · ${p.frente_raw}` : ''}
                        {rotuloLocalProducao(p) ? ` · ${rotuloLocalProducao(p)}` : ''}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-base text-text tabular-nums">
                        {formatNumber(Number(p.qtd ?? 0), 2)}{' '}
                        <span className="text-xs text-text-dim">{p.unidade ?? ''}</span>
                      </div>
                      <div className="flex items-center justify-end gap-1.5 mt-0.5">
                        {Number(p.fotos_count ?? 0) > 0 ? (
                          <span className="inline-flex items-center gap-0.5 text-2xs font-mono text-accent">
                            <Camera size={10} /> {p.fotos_count}
                          </span>
                        ) : null}
                        {p.origem === 'importacao' ? (
                          <Badge variant="outline" className="text-2xs">
                            importação
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  {p.obs ? (
                    <div className="text-2xs text-text-muted mt-1 line-clamp-2">{p.obs}</div>
                  ) : null}
                  {podeEditar(p) ? (
                    <div className="flex items-center gap-3 mt-2">
                      <button
                        type="button"
                        onClick={() => onEditar?.(p)}
                        className="inline-flex items-center gap-1 text-2xs text-text-muted hover:text-accent"
                      >
                        <Pencil size={11} /> Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => void excluir(p)}
                        className="inline-flex items-center gap-1 text-2xs text-text-muted hover:text-danger"
                        disabled={del.isPending}
                      >
                        <Trash2 size={11} /> Excluir
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function fmtBR(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

import { useMemo, type ReactNode } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Camera, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PulseBlock } from '@/components/ui/PulseBlock'
import { ErroConsulta, Vazio } from '@/components/ui/estado'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { useAuthStore } from '@/stores/auth-store'
import { formatNumber } from '@/lib/format'
import { contar } from '@/lib/rotulos'
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
  const consulta = useLancamentosDia(obraId, data)
  const { data: rows = [], isLoading } = consulta
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
      description: `Lançamento de ${p.servico_display_nome}: ${formatNumber(Number(p.qtd ?? 0), 2)} ${p.unidade ?? ''}${p.equipe_display_nome ? `, equipe ${p.equipe_display_nome}` : ''}. Não dá para desfazer.`,
      confirmLabel: 'Excluir',
      variant: 'danger'
    })
    if (!ok) return
    try {
      await del.mutateAsync({ id: p.id })
      toast.success('Lançamento excluído.')
    } catch (e) {
      toast.error(
        `Não foi possível excluir o lançamento.${e instanceof Error && e.message ? ` ${e.message}` : ''}`
      )
    }
  }

  return (
    <section
      aria-label="Lançamentos do dia"
      className={cn('flex flex-col', compacto ? 'p-4' : 'p-5')}
    >
      <h2 className="mb-3 flex flex-wrap items-baseline gap-x-3 text-lg font-semibold text-text">
        Lançamentos de {fmtBR(data)}
        {isLoading || consulta.error ? null : (
          <span className="text-sm font-normal text-text-muted">
            {contar(total, 'lançamento', 'lançamentos')}
            {fotos > 0 ? `, ${contar(fotos, 'foto', 'fotos')}` : ''}
          </span>
        )}
      </h2>

      {duplicados.size > 0 ? (
        <div className="mb-3 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-text flex items-start gap-2">
          <AlertTriangle size={15} className="shrink-0 mt-0.5 text-warn" />
          <span>
            Há serviço com mais de um lançamento para a mesma equipe neste dia. Confira se não é
            duplicidade.
          </span>
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-2" role="status" aria-label="Carregando os lançamentos do dia">
          {Array.from({ length: 3 }).map((_, i) => (
            <PulseBlock key={i} h={64} />
          ))}
        </div>
      ) : consulta.error ? (
        <ErroConsulta
          erro={consulta.error}
          oQue="os lançamentos do dia"
          aoTentar={() => void consulta.refetch()}
        />
      ) : rows.length === 0 ? (
        <Vazio>
          Nenhum lançamento neste dia. Registre a produção no formulário ou escolha outra data.
        </Vazio>
      ) : (
        <ul className="space-y-2">
          {rows.map((p) => {
            const dup = duplicados.has(`${p.item_orcamentario_id ?? ''}|${p.equipe_id ?? ''}`)
            const nFotos = Number(p.fotos_count ?? 0)
            const excluindo = del.isPending && del.variables?.id === p.id
            const local = rotuloLocalProducao(p)
            return (
              <li
                key={p.id}
                className={cn(
                  'rounded border bg-bg-panel px-3 py-2.5',
                  dup ? 'border-warn/60' : 'border-border'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-text truncate" title={p.servico_display_nome}>
                      {p.servico_grupo_codigo ? (
                        <span className="tabular text-xs text-text-muted mr-1.5">
                          {p.servico_grupo_codigo}
                        </span>
                      ) : null}
                      {p.servico_display_nome}
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-text-muted mt-0.5 min-w-0">
                      <span
                        aria-hidden
                        className="size-2.5 rounded-sm shrink-0"
                        style={{ background: p.equipe_display_cor ?? 'var(--border-strong)' }}
                      />
                      <span className="truncate">
                        {p.equipe_display_nome ?? 'Sem equipe'}
                        {p.encarregado_display_nome ? ` · ${p.encarregado_display_nome}` : ''}
                        {p.frente_raw ? ` · ${p.frente_raw}` : ''}
                        {local ? ` · ${local}` : ''}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-md font-semibold text-text tabular">
                      {formatNumber(Number(p.qtd ?? 0), 2)}{' '}
                      <span className="text-sm font-normal text-text-muted">{p.unidade ?? ''}</span>
                    </div>
                    <div className="flex items-center justify-end gap-1.5 mt-0.5">
                      {nFotos > 0 ? (
                        <span
                          className="inline-flex items-center gap-1 text-xs text-text-muted tabular"
                          title={contar(nFotos, 'foto', 'fotos')}
                        >
                          <Camera size={12} aria-hidden /> {nFotos}
                          <span className="sr-only">{nFotos === 1 ? 'foto' : 'fotos'}</span>
                        </span>
                      ) : null}
                      {p.origem === 'importacao' ? (
                        <Badge variant="outline">Importação</Badge>
                      ) : null}
                    </div>
                  </div>
                </div>
                {p.obs ? (
                  <div className="text-sm text-text-muted mt-1 line-clamp-2">{p.obs}</div>
                ) : null}
                {podeEditar(p) ? (
                  <div className="flex items-center gap-1 mt-1.5 -ml-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => onEditar?.(p)}>
                      <Pencil size={12} /> Editar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="hover:text-danger"
                      onClick={() => void excluir(p)}
                      disabled={del.isPending}
                    >
                      <Trash2 size={12} /> {excluindo ? 'Excluindo…' : 'Excluir'}
                    </Button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function fmtBR(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

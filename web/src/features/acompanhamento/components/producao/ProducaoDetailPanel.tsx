import { type ReactNode, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Pencil, Trash2, Image as ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet, SheetHeader, SheetTitle, SheetBody, SheetFooter } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TabPill } from '@/components/ui/TabPill'
import { cn } from '@/lib/utils'
import { formatNumber, formatDateTimeShort } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import type { ProducaoEnriquecida } from '@/types/acompanhamento'
import { useFotosDaProducao, useSignedUrls } from '../../hooks/fotos'
import { useDeleteLancamento, useMateriaisLancamento } from '../../hooks/lancamento'

interface Props {
  producao: ProducaoEnriquecida | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Tab = 'detalhes' | 'tarefa' | 'fotos'

export function ProducaoDetailPanel({ producao, open, onOpenChange }: Props): ReactNode {
  if (!producao) return null
  // `key` por lançamento: a aba volta para "Detalhes" ao trocar de registro.
  return <Panel key={producao.id} p={producao} open={open} onOpenChange={onOpenChange} />
}

function Panel({
  p,
  open,
  onOpenChange
}: {
  p: ProducaoEnriquecida
  open: boolean
  onOpenChange: (o: boolean) => void
}): ReactNode {
  const [tab, setTab] = useState<Tab>('detalhes')
  const navigate = useNavigate()
  const confirm = useConfirm()
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const uid = useAuthStore((s) => s.profile?.id ?? null)
  const del = useDeleteLancamento()
  const { data: materiais = [] } = useMateriaisLancamento(open ? p.id : null)
  const { data: fotos = [] } = useFotosDaProducao(open && tab === 'fotos' ? p.obra_id : null, p.id)
  const fotoIds = useMemo(() => fotos.map((f) => f.id), [fotos])
  const { urls } = useSignedUrls(fotoIds)

  // a produção das viagens é a soma das viagens do dia: muda pelas viagens (Acompanhamento › Viagens)
  const podeEditar =
    p.origem !== 'viagens' &&
    (role === 'god' ||
      role === 'adm' ||
      role === 'engenheiro' ||
      (role === 'apoio' && p.criado_por === uid))
  const converteu = Number(p.fator_conversao ?? 1) !== 1
  const valor = converteu ? Number(p.qtd_convertida ?? 0) : Number(p.qtd ?? 0)
  const unidade = converteu ? p.unidade_plano : (p.unidade ?? p.unidade_plano)

  const excluir = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Excluir este lançamento?',
      description: `${p.servico_display_nome} · ${formatDate(p.data)} · ${formatNumber(Number(p.qtd ?? 0), 2)} ${p.unidade ?? ''}\n\nAs fotos vinculadas ficam como avulsas. Não dá pra desfazer.`,
      confirmLabel: 'Excluir',
      variant: 'danger'
    })
    if (!ok) return
    try {
      await del.mutateAsync({ id: p.id })
      toast.success('Lançamento excluído.')
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao excluir')
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} className="w-[480px]">
      <SheetHeader>
        <SheetTitle>{p.servico_display_nome ?? p.servico_nome ?? 'Lançamento'}</SheetTitle>
        <p className="text-2xs font-mono text-text-dim mt-0.5">
          {formatDate(p.data)} · qtd {formatNumber(valor, 2)}
          {unidade ? ` ${unidade}` : ''}
          {converteu
            ? ` (lançado ${formatNumber(Number(p.qtd ?? 0))} ${p.unidade ?? ''} × ${p.fator_conversao})`
            : ''}
        </p>
      </SheetHeader>
      <div className="border-b border-border px-4 flex items-center gap-3" role="tablist">
        {(['detalhes', 'tarefa', 'fotos'] as Tab[]).map((t) => (
          <TabPill key={t} active={tab === t} onClick={() => setTab(t)}>
            {t === 'detalhes'
              ? 'Detalhes'
              : t === 'tarefa'
                ? 'Tarefa baseline'
                : `Fotos (${p.fotos_count ?? 0})`}
          </TabPill>
        ))}
      </div>
      <SheetBody>
        {tab === 'detalhes' && (
          <div className="space-y-3 text-xs">
            <Field
              label="Item do orçamento"
              value={
                p.servico_grupo_codigo
                  ? `${p.servico_grupo_codigo} — ${p.servico_grupo_descricao ?? p.servico_display_nome}`
                  : p.item_orcamentario_id
                    ? p.servico_display_nome
                    : 'Item removido do orçamento'
              }
            />
            {p.equipe_id ? (
              <Field
                label="Equipe"
                value={p.equipe_display_nome ?? '—'}
                indicador={
                  <span
                    className="size-2 rounded-sm mt-1"
                    style={{ background: p.equipe_display_cor ?? 'var(--text-dim)' }}
                  />
                }
                hint={p.equipe_tipo ?? undefined}
              />
            ) : (
              <Field
                label="Equipe"
                value="Sem equipe"
                hint="Informe a equipe para comparar com a produtividade planejada"
              />
            )}
            <Field label="Encarregado" value={p.encarregado_display_nome ?? '—'} />
            <Field label="Frente" value={p.frente_raw ?? '—'} />
            <Field
              label="Local / estacas"
              value={
                [
                  p.trecho_nome
                    ? p.trecho_tipo === 'area'
                      ? `Área ${p.trecho_nome}`
                      : p.trecho_nome
                    : null,
                  p.estaca_inicial || p.estaca_final
                    ? `${p.estaca_inicial ?? '—'} → ${p.estaca_final ?? '—'}`
                    : null
                ]
                  .filter(Boolean)
                  .join(' · ') || '—'
              }
            />
            <Field label="Observação" value={p.obs ?? '—'} multiline />
            {materiais.length > 0 && (
              <div>
                <div className="text-2xs font-mono uppercase text-text-dim mb-0.5">Materiais</div>
                <ul className="space-y-0.5">
                  {materiais.map((m) => (
                    <li key={m.id} className="text-text flex items-center gap-2">
                      <span className="truncate">{m.nome}</span>
                      {m.quantidade != null ? (
                        <span className="font-mono text-text-muted shrink-0">
                          {formatNumber(Number(m.quantidade), 2)} {m.unidade ?? ''}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Field
              label="Registro"
              value={`${p.origem === 'importacao' ? 'Importação' : 'App'} · ${p.criado_por_nome ?? '—'}`}
              hint={`criado ${formatDateTimeShort(p.created_at)}${p.updated_at && p.updated_at !== p.created_at ? ` · editado ${formatDateTimeShort(p.updated_at)}` : ''}`}
            />
          </div>
        )}
        {tab === 'tarefa' && (
          <div className="space-y-3 text-xs">
            {p.tarefa_baseline_id ? (
              <>
                <Field
                  label="Serviço (item)"
                  value={`${p.servico_grupo_codigo ?? ''} — ${p.servico_grupo_descricao ?? ''}`}
                />
                <Field
                  label="Tarefa baseline"
                  value={`${formatDate(p.tarefa_data_inicio)} → ${formatDate(p.tarefa_data_fim)}`}
                />
                <p className="text-text-muted leading-relaxed text-2xs font-mono">
                  Esta produção conta para uma tarefa do baseline ativo. Compare o avanço acumulado
                  na página <span className="text-accent">Previsto × Realizado</span>.
                </p>
              </>
            ) : (
              <div className="text-text-dim text-2xs font-mono">
                Este item ainda não está programado no baseline ativo. Programe-o em{' '}
                <span className="text-accent">Planejamento → Programação por equipes</span> e
                promova a baseline.
              </div>
            )}
          </div>
        )}
        {tab === 'fotos' && (
          <div className="space-y-2">
            {fotos.length === 0 ? (
              <div className="text-text-dim text-2xs font-mono flex items-center gap-2">
                <ImageIcon size={12} /> Nenhuma foto vinculada a este lançamento.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {fotos.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="aspect-square rounded overflow-hidden border border-border bg-bg-elevated hover:border-accent"
                    title={f.captured_at ? formatDateTimeShort(f.captured_at) : undefined}
                    onClick={() => void navigate({ to: '/acompanhamento/fotos' })}
                  >
                    {urls[f.id] ? (
                      <img
                        src={urls[f.id]}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-text-dim">
                        <ImageIcon size={16} />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
            <div className="text-2xs font-mono text-text-dim">
              Veja todas em <span className="text-accent">Fotos &amp; Mapa</span>. Total
              correlacionado: <strong className="text-text">{p.fotos_count ?? 0}</strong>
            </div>
          </div>
        )}
      </SheetBody>
      {podeEditar ? (
        <SheetFooter className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-danger"
            onClick={() => void excluir()}
            disabled={del.isPending}
          >
            <Trash2 size={12} /> Excluir
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onOpenChange(false)
              void navigate({
                to: '/acompanhamento/lancar',
                search: { editar: p.id, data: p.data } as never
              })
            }}
          >
            <Pencil size={12} /> Editar
          </Button>
        </SheetFooter>
      ) : p.origem === 'viagens' ? (
        <SheetFooter>
          <span className="text-2xs text-text-muted">
            Soma das viagens do dia — altere as viagens em Acompanhamento › Viagens.
          </span>
        </SheetFooter>
      ) : p.origem === 'importacao' && p.importacao_id ? (
        <SheetFooter>
          <Badge variant="default" className="text-2xs">
            lote {p.importacao_id.slice(0, 8)}
          </Badge>
        </SheetFooter>
      ) : null}
    </Sheet>
  )
}

function Field({
  label,
  value,
  hint,
  multiline,
  indicador
}: {
  label: string
  value: string
  hint?: string
  multiline?: boolean
  indicador?: ReactNode
}): ReactNode {
  return (
    <div>
      <div className="text-2xs font-mono uppercase text-text-dim mb-0.5">{label}</div>
      <div className={cn('flex items-start gap-2', multiline ? 'whitespace-pre-wrap' : 'truncate')}>
        {indicador}
        <span className="text-text">{value}</span>
      </div>
      {hint && <div className="text-2xs font-mono text-text-dim mt-0.5">{hint}</div>}
    </div>
  )
}

function formatDate(s: string | null | undefined): string {
  if (!s) return '—'
  return new Date(s + (s.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('pt-BR')
}

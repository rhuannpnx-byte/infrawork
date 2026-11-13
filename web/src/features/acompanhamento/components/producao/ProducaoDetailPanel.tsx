import { type ReactNode, useId, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Pencil, Trash2, Image as ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet, SheetHeader, SheetTitle, SheetBody, SheetFooter } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { TabPill } from '@/components/ui/TabPill'
import { Carregando, ErroConsulta } from '@/components/ui/estado'
import { cn } from '@/lib/utils'
import { motivoDoErro } from '@/features/acompanhamento/lib/mensagem-erro'
import { formatNumber, formatDateTimeShort } from '@/lib/format'
import { contar } from '@/lib/rotulos'
import { useAuthStore } from '@/stores/auth-store'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import type { ProducaoEnriquecida, ProducaoOrigem } from '@/types/acompanhamento'
import { useFotosDaProducao, useSignedUrls } from '../../hooks/fotos'
import { useDeleteLancamento, useMateriaisLancamento } from '../../hooks/lancamento'

interface Props {
  producao: ProducaoEnriquecida | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Tab = 'detalhes' | 'tarefa' | 'fotos'

const ROTULO_ORIGEM: Record<ProducaoOrigem, string> = {
  app: 'Site',
  campo: 'App de campo',
  viagens: 'Viagens',
  importacao: 'Importação'
}

const ROTULO = 'text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'

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
  const idBase = useId()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const uid = useAuthStore((s) => s.profile?.id ?? null)
  const del = useDeleteLancamento()
  const { data: materiais = [] } = useMateriaisLancamento(open ? p.id : null)
  const consultaFotos = useFotosDaProducao(open && tab === 'fotos' ? p.obra_id : null, p.id)
  const { data: fotos = [] } = consultaFotos
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
  const nomeServico = p.servico_display_nome ?? p.servico_nome ?? 'Lançamento'
  const nFotos = Number(p.fotos_count ?? 0)

  const excluir = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Excluir este lançamento?',
      description: `Lançamento de ${nomeServico} em ${formatDate(p.data)}: ${formatNumber(Number(p.qtd ?? 0), 2)} ${p.unidade ?? ''}.\n\nAs fotos vinculadas ficam como avulsas. Não dá para desfazer.`,
      confirmLabel: 'Excluir',
      variant: 'danger'
    })
    if (!ok) return
    try {
      await del.mutateAsync({ id: p.id })
      toast.success('Lançamento excluído.')
      onOpenChange(false)
    } catch (e) {
      toast.error(`Não foi possível excluir o lançamento.${motivoDoErro(e)}`)
    }
  }

  const abas: Array<{ id: Tab; rotulo: string }> = [
    { id: 'detalhes', rotulo: 'Detalhes' },
    { id: 'tarefa', rotulo: 'Linha de base' },
    { id: 'fotos', rotulo: `Fotos (${nFotos})` }
  ]
  const local =
    [
      p.trecho_nome ? (p.trecho_tipo === 'area' ? `Área ${p.trecho_nome}` : p.trecho_nome) : null,
      p.estaca_inicial || p.estaca_final
        ? `${p.estaca_inicial ?? '—'} a ${p.estaca_final ?? '—'}`
        : null
    ]
      .filter(Boolean)
      .join(', ') || '—'

  return (
    <Sheet open={open} onOpenChange={onOpenChange} className="w-[480px]">
      <SheetHeader>
        <SheetTitle>{nomeServico}</SheetTitle>
        <p className="text-sm text-text-muted mt-0.5 tabular">
          {formatDate(p.data)}, {formatNumber(valor, 2)}
          {unidade ? ` ${unidade}` : ''}
          {converteu
            ? ` (lançado: ${formatNumber(Number(p.qtd ?? 0))} ${p.unidade ?? ''} × ${p.fator_conversao})`
            : ''}
        </p>
      </SheetHeader>
      <div
        className="border-b border-border px-4 flex items-center gap-4"
        role="tablist"
        aria-label="Partes do lançamento"
      >
        {abas.map((a) => (
          <TabPill
            key={a.id}
            id={`${idBase}-aba-${a.id}`}
            aria-controls={`${idBase}-painel`}
            active={tab === a.id}
            onClick={() => setTab(a.id)}
            className="text-sm py-2.5 text-text-muted"
          >
            {a.rotulo}
          </TabPill>
        ))}
      </div>
      <SheetBody>
        <div id={`${idBase}-painel`} role="tabpanel" aria-labelledby={`${idBase}-aba-${tab}`}>
          {tab === 'detalhes' && (
            <dl className="space-y-3.5">
              <Field
                label="Item do orçamento"
                value={
                  p.servico_grupo_codigo
                    ? `${p.servico_grupo_codigo} ${p.servico_grupo_descricao ?? p.servico_display_nome}`
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
                      aria-hidden
                      className="size-2.5 rounded-sm mt-1.5 shrink-0"
                      style={{ background: p.equipe_display_cor ?? 'var(--text-dim)' }}
                    />
                  }
                  hint={p.equipe_tipo ?? undefined}
                />
              ) : (
                <Field
                  label="Equipe"
                  value="Sem equipe"
                  hint="Informe a equipe para comparar com a produtividade prevista."
                />
              )}
              <Field label="Encarregado" value={p.encarregado_display_nome ?? '—'} />
              <Field label="Frente" value={p.frente_raw ?? '—'} />
              <Field label="Local e estacas" value={local} />
              <Field label="Observação" value={p.obs ?? '—'} multiline />
              {materiais.length > 0 && (
                <div>
                  <dt className={ROTULO}>Materiais</dt>
                  <dd className="mt-1">
                    <ul className="space-y-1 text-sm">
                      {materiais.map((m) => (
                        <li key={m.id} className="text-text flex items-baseline gap-2">
                          <span className="min-w-0 break-words">{m.nome}</span>
                          {m.quantidade != null ? (
                            <span className="tabular text-text-muted shrink-0 ml-auto">
                              {formatNumber(Number(m.quantidade), 2)} {m.unidade ?? ''}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
              <Field
                label="Registro"
                value={`${ROTULO_ORIGEM[p.origem] ?? p.origem}${p.criado_por_nome ? `, por ${p.criado_por_nome}` : ''}`}
                hint={`Criado em ${formatDateTimeShort(p.created_at)}.${p.updated_at && p.updated_at !== p.created_at ? ` Editado em ${formatDateTimeShort(p.updated_at)}.` : ''}`}
              />
            </dl>
          )}
          {tab === 'tarefa' &&
            (p.tarefa_baseline_id ? (
              <div className="space-y-3.5">
                <dl className="space-y-3.5">
                  <Field
                    label="Serviço"
                    value={
                      `${p.servico_grupo_codigo ?? ''} ${p.servico_grupo_descricao ?? ''}`.trim() ||
                      '—'
                    }
                  />
                  <Field
                    label="Tarefa da linha de base"
                    value={`De ${formatDate(p.tarefa_data_inicio)} a ${formatDate(p.tarefa_data_fim)}`}
                  />
                </dl>
                <p className="text-sm text-text-muted">
                  Esta produção conta para uma tarefa da linha de base vigente.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onOpenChange(false)
                    void navigate({ to: '/acompanhamento/comparativo' })
                  }}
                >
                  Ver previsto e realizado
                </Button>
              </div>
            ) : (
              <p className="text-sm text-text-muted">
                Este serviço ainda não está programado na linha de base vigente. Programe-o no
                cronograma e trave o plano como linha de base para comparar com o previsto.
              </p>
            ))}
          {tab === 'fotos' && (
            <div className="space-y-3">
              {consultaFotos.isLoading ? (
                <Carregando texto="Carregando as fotos…" />
              ) : consultaFotos.error ? (
                <ErroConsulta
                  erro={consultaFotos.error}
                  oQue="as fotos do lançamento"
                  aoTentar={() => void consultaFotos.refetch()}
                  compacto
                />
              ) : fotos.length === 0 ? (
                <p className="text-sm text-text-muted flex items-center gap-2">
                  <ImageIcon size={14} className="shrink-0" /> Nenhuma foto vinculada a este
                  lançamento.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {fotos.map((f, i) => (
                    <button
                      key={f.id}
                      type="button"
                      className="aspect-square rounded overflow-hidden border border-border bg-bg-elevated hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      aria-label={`Abrir a foto ${i + 1}${f.captured_at ? `, de ${formatDateTimeShort(f.captured_at)},` : ''} em Fotos e mapa`}
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
              {nFotos > 0 ? (
                <p className="text-sm text-text-muted">
                  {contar(nFotos, 'foto ligada', 'fotos ligadas')} a este lançamento. Clique numa
                  foto para abrir a página Fotos e mapa.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </SheetBody>
      {podeEditar ? (
        <SheetFooter className="justify-between">
          <Button
            variant="danger"
            size="sm"
            onClick={() => void excluir()}
            disabled={del.isPending}
          >
            <Trash2 size={13} /> {del.isPending ? 'Excluindo…' : 'Excluir'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onOpenChange(false)
              void navigate({
                to: '/acompanhamento/lancar',
                search: { editar: p.id, data: p.data } as never
              })
            }}
          >
            <Pencil size={13} /> Editar
          </Button>
        </SheetFooter>
      ) : p.origem === 'viagens' ? (
        <SheetFooter className="justify-between">
          <span className="text-sm text-text-muted">
            Soma das viagens do dia. Para mudar, altere as viagens.
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            onClick={() => {
              onOpenChange(false)
              void navigate({ to: '/acompanhamento/viagens' })
            }}
          >
            Abrir viagens
          </Button>
        </SheetFooter>
      ) : p.origem === 'importacao' && p.importacao_id ? (
        <SheetFooter className="justify-start">
          <span className="text-sm text-text-muted">
            Lote de importação <span className="tabular">{p.importacao_id.slice(0, 8)}</span>
          </span>
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
      <dt className={ROTULO}>{label}</dt>
      <dd className="mt-0.5 text-sm">
        <span className={cn('flex items-start gap-2', multiline && 'whitespace-pre-wrap')}>
          {indicador}
          <span className="text-text min-w-0 break-words">{value}</span>
        </span>
        {hint ? <span className="block text-sm text-text-muted mt-0.5">{hint}</span> : null}
      </dd>
    </div>
  )
}

function formatDate(s: string | null | undefined): string {
  if (!s) return '—'
  return new Date(s + (s.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('pt-BR')
}

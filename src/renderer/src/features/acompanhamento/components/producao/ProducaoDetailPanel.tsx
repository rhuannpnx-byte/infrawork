import { type ReactNode, useState } from 'react'
import { Sheet, SheetHeader, SheetTitle, SheetBody } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ProducaoEnriquecida } from '@/types/acompanhamento'

interface Props {
  producao: ProducaoEnriquecida | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Tab = 'detalhes' | 'tarefa' | 'fotos'

export function ProducaoDetailPanel({ producao, open, onOpenChange }: Props): ReactNode {
  const [tab, setTab] = useState<Tab>('detalhes')
  if (!producao) return null
  const p = producao
  return (
    <Sheet open={open} onOpenChange={onOpenChange} className="w-[480px]">
      <SheetHeader>
        <SheetTitle>
          {p.servico_display_nome ?? p.siga_servico_nome ?? 'Apontamento'}
        </SheetTitle>
        <p className="text-2xs font-mono text-text-dim mt-0.5">
          {(() => {
            const converteu = p.servico_match_id && Number(p.fator_conversao ?? 1) !== 1
            const valor = converteu ? Number(p.qtd_convertida ?? 0) : Number(p.qtd ?? 0)
            const unidade = converteu ? p.unidade_plano : (p.siga_unidade_nome ?? p.unidade_plano)
            return (
              <>
                {formatDate(p.data)} · qtd {valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                {unidade ? ` ${unidade}` : ''}
                {converteu ? ` (raw ${Number(p.qtd ?? 0).toLocaleString('pt-BR')} ${p.siga_unidade_nome ?? ''} × ${p.fator_conversao})` : ''}
              </>
            )
          })()}
        </p>
      </SheetHeader>
      <div className="border-b border-border px-4 flex items-center gap-3">
        {(['detalhes', 'tarefa', 'fotos'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'py-2 text-xs font-mono border-b-2 transition-colors',
              tab === t ? 'border-accent text-text' : 'border-transparent text-text-dim hover:text-text'
            )}
          >
            {t === 'detalhes' ? 'Detalhes' : t === 'tarefa' ? 'Tarefa baseline' : `Fotos (${p.fotos_count ?? 0})`}
          </button>
        ))}
      </div>
      <SheetBody>
        {tab === 'detalhes' && (
          <div className="space-y-3 text-xs">
            <Field label="Equipe SIGA" value={p.siga_equipe_nome ?? '—'} />
            {p.equipe_planejamento_id ? (
              <Field
                label="Equipe planejamento"
                value={p.equipe_display_nome ?? '—'}
                indicador={<span className="size-2 rounded-sm" style={{ background: p.equipe_display_cor ?? '#94a3b8' }} />}
              />
            ) : (
              <Field
                label="Equipe planejamento"
                value="Não vinculada"
                hint="Vincule na página Equipes para comparar previsto×realizado"
              />
            )}
            <Field label="Encarregado" value={p.siga_encarregado_nome ?? '—'} />
            <Field label="Frente" value={p.frente ?? '—'} />
            <Field label="Trecho" value={p.trecho ?? '—'} />
            <Field label="Estaca" value={p.estaca_inicial ?? '—'} />
            <Field label="Observação" value={p.obs ?? '—'} multiline />
            <Field
              label="Sincronizado"
              value={formatDateTime(p.sincronizado_em)}
              hint={p.siga_updated_at ? `SIGA: ${formatDateTime(p.siga_updated_at)}` : undefined}
            />
          </div>
        )}
        {tab === 'tarefa' && (
          <div className="space-y-3 text-xs">
            {p.tarefa_baseline_id ? (
              <>
                <Field label="Servico grupo" value={`${p.servico_grupo_codigo ?? ''} — ${p.servico_grupo_descricao ?? ''}`} />
                <Field label="Tarefa baseline" value={`${formatDate(p.tarefa_data_inicio)} → ${formatDate(p.tarefa_data_fim)}`} />
                <p className="text-text-muted leading-relaxed text-2xs font-mono">
                  Esta produção está vinculada a uma tarefa do baseline ativo. Compare o avanço acumulado na página{' '}
                  <span className="text-accent">Previsto × Realizado</span>.
                </p>
              </>
            ) : (
              <div className="text-text-dim text-2xs font-mono">
                Apontamento sem vínculo com tarefa do baseline. Vincule o serviço na página{' '}
                <span className="text-accent">Equipes</span>.
              </div>
            )}
          </div>
        )}
        {tab === 'fotos' && (
          <div className="text-text-dim text-2xs font-mono">
            Visualize as fotos na página <span className="text-accent">Fotos &amp; Mapa</span> filtrando por serviço{' '}
            <Badge variant="default" className="ml-1">{p.siga_servico_nome ?? '—'}</Badge> e data {formatDate(p.data)}.
            <br />Total de fotos correlacionadas: <strong className="text-text">{p.fotos_count ?? 0}</strong>
          </div>
        )}
      </SheetBody>
    </Sheet>
  )
}

function Field({ label, value, hint, multiline, indicador }: {
  label: string; value: string; hint?: string; multiline?: boolean; indicador?: ReactNode
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
function formatDateTime(s: string | null | undefined): string {
  if (!s) return '—'
  return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

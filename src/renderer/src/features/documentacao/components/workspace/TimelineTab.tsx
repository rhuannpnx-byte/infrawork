import { useMemo, type ReactNode } from 'react'
import { FileSearch } from 'lucide-react'
import { EmptyState } from '@/components/layout/EmptyState'
import { cn } from '@/lib/utils'
import { fmtBRL } from '@/lib/money'
import type { DossieEvento, ObraDossier } from '@/types/documentacao'

// Cor do marcador por tipo (slug canônico vindo do resolver).
const COR_TIPO: Record<string, string> = {
  assinatura: 'bg-accent',
  publicacao: 'bg-accent',
  apostilamento: 'bg-violet-400',
  aditivo: 'bg-amber-400',
  ordem_servico: 'bg-success',
  paralisacao: 'bg-red-400',
  termino_exec: 'bg-rose-400',
  termino_vig: 'bg-rose-400',
  art: 'bg-sky-400',
  licenca: 'bg-emerald-400'
}

// Rótulo curto do tipo (chip), já que a linha é contínua (sem cabeçalhos de lane).
const LABEL_TIPO: Record<string, string> = {
  assinatura: 'Assinatura',
  publicacao: 'Publicação',
  ordem_servico: 'Ordem de Serviço',
  paralisacao: 'Paralisação',
  termino_exec: 'Término execução',
  termino_vig: 'Término vigência',
  apostilamento: 'Reajuste',
  aditivo: 'Aditivo',
  licenca: 'Licença',
  art: 'ART'
}
const labelTipo = (t: string): string => LABEL_TIPO[t] ?? 'Evento'

const MES = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** Data respeitando a precisão: ano-só, mês/ano ou dd/mm/aaaa. */
function fmtData(e: DossieEvento): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(e.data_norm ?? '')
  if (m) {
    const [, y, mm, dd] = m
    if (e.data_precisao === 'ano') return y
    if (e.data_precisao === 'mes') return `${MES[Number(mm)]}/${y}`
    return `${dd}/${mm}/${y}`
  }
  return e.data_rotulo ?? '—'
}

const anoDe = (e: DossieEvento): string | null => (e.data_norm ?? '').slice(0, 4) || null

interface Props {
  dossie: ObraDossier
  onAbrirFonte: (docId: string | null, pagina: number | null) => void
}

export function TimelineTab({ dossie, onAbrirFonte }: Props): ReactNode {
  // Linha do tempo CONTÍNUA: todos os eventos numa única sequência cronológica
  // (sem zerar por tipo). Sem data vão para o fim. O marcador de ano (separador
  // leve) é pré-computado aqui para não mutar estado durante o render.
  const eventos = useMemo(() => {
    const comData = (e: DossieEvento): string => e.data_norm ?? '9999-99-99'
    const ordenados = [...(dossie.eventos ?? [])].sort((a, b) =>
      comData(a).localeCompare(comData(b))
    )
    return ordenados.map((e, idx) => {
      const ano = anoDe(e)
      const anoPrev = idx > 0 ? anoDe(ordenados[idx - 1]) : null
      return { e, ano, novoAno: ano != null && ano !== anoPrev }
    })
  }, [dossie.eventos])

  if (!eventos.length) {
    return (
      <EmptyState
        icon="git-commit"
        title="Sem eventos na linha do tempo"
        description="Eventos (assinatura, OS, ARTs, apostilamentos, aditivos, licenças) são extraídos dos documentos durante a ingestão."
      />
    )
  }

  return (
    <div className="h-full overflow-auto p-5">
      <div className="relative max-w-2xl mx-auto pl-8">
        {/* Uma única trilha contínua. */}
        <div className="absolute left-2 top-1.5 bottom-1.5 w-0.5 bg-gradient-to-b from-accent via-border to-violet-400/50 rounded" />
        {eventos.map(({ e, ano, novoAno }, i) => {
          return (
            <div key={i}>
              {novoAno ? (
                <div className="relative -ml-8 mb-2 mt-3 first:mt-0">
                  <span className="inline-block rounded bg-bg-elevated border border-border px-2 py-0.5 text-2xs font-mono font-bold text-text-muted">
                    {ano}
                  </span>
                </div>
              ) : null}
              <div className="relative mb-3">
                <span
                  className={cn(
                    'absolute -left-[26px] top-1.5 w-3.5 h-3.5 rounded-full border-2 border-bg',
                    COR_TIPO[e.tipo] ?? 'bg-text-dim'
                  )}
                />
                <div className="rounded-lg border border-border bg-bg-panel px-3.5 py-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-2xs font-mono font-bold text-accent">{fmtData(e)}</span>
                    <span className="text-[9px] font-medium rounded px-1.5 py-0.5 bg-bg text-text-muted border border-border/60">
                      {labelTipo(e.tipo)}
                    </span>
                    {e.data_precisao === 'ano' || e.data_precisao === 'mes' ? (
                      <span className="text-[9px] text-text-dim/70">
                        ~{e.data_precisao === 'ano' ? 'ano' : 'mês'}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-sm font-medium text-text mt-0.5">{e.rotulo}</div>
                  {e.descricao ? (
                    <div className="text-xs text-text-muted mt-0.5">{e.descricao}</div>
                  ) : null}
                  <div className="flex items-center gap-3 mt-1.5">
                    {e.valor_resultante != null ? (
                      <span className="text-2xs font-mono text-text">
                        → {fmtBRL(e.valor_resultante)}
                      </span>
                    ) : e.valor != null ? (
                      <span className="text-2xs font-mono text-text">{fmtBRL(e.valor)}</span>
                    ) : null}
                    {e.delta != null ? (
                      <span className="text-2xs font-mono text-success">
                        {e.delta >= 0 ? '+' : ''}
                        {fmtBRL(e.delta)}
                      </span>
                    ) : null}
                    {e.doc_id ? (
                      <button
                        type="button"
                        onClick={() => onAbrirFonte(e.doc_id ?? null, null)}
                        className="inline-flex items-center gap-1 text-2xs text-accent hover:underline ml-auto"
                      >
                        <FileSearch size={11} /> documento
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

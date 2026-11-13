import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronRight, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { CatPainel } from '@/core/db/entities'
import type { StatusServico } from '@/types/dtos'
import { PainelShell } from '@/features/painel/PainelShell'
import { BarraAvanco } from '@/features/painel/graficos'
import {
  contarStatus,
  moeda,
  ordenarServicos,
  pct,
  qtd,
  STATUS_INFO,
  statusInfo,
  textoDesvio,
  TOM_FUNDO,
  TOM_TEXTO,
} from '@/features/painel/lib'

/** Visão estratégica › Serviços: todos os serviços na ordem de atenção, com filtro por situação. */
export function PainelServicosRoute() {
  return <PainelShell titulo="Serviços">{(p) => <Servicos p={p} />}</PainelShell>
}

const FILTROS: (StatusServico | 'todos')[] = [
  'todos',
  'atrasado',
  'em_risco',
  'em_andamento',
  'no_prazo',
  'adiantado',
  'nao_iniciado',
  'concluido',
  'sem_plano',
]

function Servicos({ p }: { p: CatPainel }) {
  const [params, setParams] = useSearchParams()
  const filtro = (params.get('status') as StatusServico | null) ?? 'todos'
  const [busca, setBusca] = useState('')
  const contagem = useMemo(() => contarStatus(p.servicos ?? []), [p.servicos])
  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return ordenarServicos(p.servicos ?? []).filter(
      (s) =>
        (filtro === 'todos' || s.status === filtro) &&
        (!termo || `${s.codigo} ${s.descricao}`.toLowerCase().includes(termo)),
    )
  }, [p.servicos, filtro, busca])

  return (
    <div className="space-y-3">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist">
        {FILTROS.filter((f) => f === 'todos' || contagem[f]).map((f) => {
          const ativo = f === filtro
          const info = f === 'todos' ? null : STATUS_INFO[f]
          return (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={ativo}
              onClick={() => setParams(f === 'todos' ? {} : { status: f }, { replace: true })}
              className={cn(
                'flex min-h-touch flex-shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm',
                ativo
                  ? 'border-accent bg-accent/10 font-semibold text-on-surface'
                  : 'border-border-strong bg-bg-panel text-on-surface-dim',
              )}
            >
              {info && <span className={cn('h-2 w-2 rounded-full', TOM_FUNDO[info.tom])} />}
              {info ? info.label : 'Todos'}
              <span className="text-on-surface-muted tabular">
                {f === 'todos' ? (p.servicos ?? []).length : contagem[f]}
              </span>
            </button>
          )
        })}
      </div>

      <label className="flex items-center gap-2 rounded-md border border-border-strong bg-bg-panel px-3 focus-within:border-accent">
        <Search className="h-4 w-4 text-on-surface-muted" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar serviço"
          className="h-11 min-w-0 flex-1 bg-transparent text-base text-on-surface outline-none placeholder:text-on-surface-muted focus-visible:ring-0"
        />
      </label>

      {lista.length === 0 ? (
        <p className="py-8 text-center text-sm text-on-surface-dim">
          Nenhum serviço neste filtro.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="painel-servicos">
          {lista.map((s) => {
            const st = statusInfo(s.status)
            const dv = textoDesvio(s.desvio_dias)
            return (
              <li key={s.id}>
                <Link
                  to={`/painel/servicos/${s.id}`}
                  className="block rounded-md border border-border bg-bg-panel p-3 active:bg-bg-elevated"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-on-surface">
                        <span className="text-on-surface-dim tabular">{s.codigo}</span>{' '}
                        {s.descricao}
                      </p>
                      <p className="mt-0.5 text-xs">
                        <span className={TOM_TEXTO[st.tom]}>{st.label}</span>
                        {dv && <span className={TOM_TEXTO[dv.tom]}> · {dv.texto}</span>}
                      </p>
                    </div>
                    <ChevronRight className="mt-0.5 h-5 w-5 flex-shrink-0 text-on-surface-muted" />
                  </div>
                  <BarraAvanco
                    real={s.pct_avanco}
                    esperado={s.pct_esperado}
                    tom={st.tom}
                    className="mt-2.5"
                  />
                  <div className="mt-1.5 flex items-baseline justify-between gap-2 whitespace-nowrap text-xs text-on-surface-dim tabular">
                    <span>
                      <span className="text-on-surface">{pct(s.pct_avanco)}</span>
                      {s.pct_esperado != null && ` · esp. ${pct(s.pct_esperado)}`}
                    </span>
                    <span className="text-on-surface">{moeda(s.valor_executado)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-2xs text-on-surface-muted tabular">
                    {qtd(s.qtd_real)} de {qtd(s.qtd_plan, s.unidade)}
                  </p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

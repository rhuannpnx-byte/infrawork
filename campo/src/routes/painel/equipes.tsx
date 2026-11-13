import { Fragment, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { formatBR } from '@/lib/datas'
import { cn } from '@/lib/cn'
import { contar } from '@/lib/texto'
import type { CatPainel } from '@/core/db/entities'
import type { PainelEquipeDto } from '@/types/dtos'
import { PainelShell, Secao } from '@/features/painel/PainelShell'
import { pct, qtd, semLancamentoHoje } from '@/features/painel/lib'

/** Visão estratégica › Equipes e encarregados: quem lançou hoje, produção por serviço e aderência à meta. */
export function PainelEquipesRoute() {
  return <PainelShell titulo="Equipes e encarregados">{(p) => <Equipes p={p} />}</PainelShell>
}

function Equipes({ p }: { p: CatPainel }) {
  const [params, setParams] = useSearchParams()
  const aba = params.get('aba') === 'encarregados' ? 'encarregados' : 'equipes'
  const lista = (aba === 'equipes' ? p.equipes : p.encarregados) ?? []
  const semHoje = semLancamentoHoje(lista)
  const ordenada = [...lista].sort(
    (a, b) =>
      Number(b.lancou_hoje) - Number(a.lancou_hoje) ||
      Number(b.ativa_semana) - Number(a.ativa_semana) ||
      (b.ultimo ?? '').localeCompare(a.ultimo ?? ''),
  )

  return (
    <div className="space-y-4">
      <div
        className="grid grid-cols-2 rounded-md border border-border-strong bg-bg-panel p-0.5"
        role="tablist"
      >
        {(['equipes', 'encarregados'] as const).map((a) => (
          <button
            key={a}
            type="button"
            role="tab"
            aria-selected={aba === a}
            onClick={() => setParams(a === 'equipes' ? {} : { aba: a }, { replace: true })}
            className={cn(
              'min-h-touch rounded-sm px-2 text-sm',
              aba === a ? 'bg-accent font-semibold text-accent-fg' : 'text-on-surface-dim',
            )}
          >
            {a === 'equipes'
              ? `Equipes (${(p.equipes ?? []).length})`
              : `Encarregados (${(p.encarregados ?? []).length})`}
          </button>
        ))}
      </div>

      {semHoje.length > 0 && (
        <Secao titulo="Sem lançamento hoje" className="border-warn/50">
          <ul className="space-y-1.5" data-testid="painel-sem-hoje">
            {semHoje.map((e) => (
              <li key={e.id ?? e.nome} className="flex justify-between gap-2 text-sm">
                <span className="truncate text-on-surface">{e.nome}</span>
                <span className="flex-shrink-0 text-xs text-warn">
                  último {e.ultimo ? formatBR(e.ultimo).slice(0, 5) : '—'}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-on-surface-muted">
            Trabalharam nesta semana e ainda não têm produção lançada hoje.
          </p>
        </Secao>
      )}

      {ordenada.length === 0 ? (
        <p className="py-8 text-center text-sm text-on-surface-dim">
          Nenhuma produção com {aba === 'equipes' ? 'equipe' : 'encarregado'} nos últimos 30 dias.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="painel-equipes">
          {ordenada.map((e) => (
            <CartaoEquipe
              key={e.id ?? `sem-${e.nome}`}
              e={e}
              comAderencia={aba === 'equipes'}
              filtro={aba === 'equipes' ? 'equipe' : 'encarregado'}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function CartaoEquipe({
  e,
  comAderencia,
  filtro,
}: {
  e: PainelEquipeDto
  comAderencia: boolean
  filtro: 'equipe' | 'encarregado'
}) {
  const [aberto, setAberto] = useState(false)
  const servicos = [...(e.servicos ?? [])].sort((a, b) => Number(b.d30 ?? 0) - Number(a.d30 ?? 0))
  return (
    <li className="rounded-md border border-border bg-bg-panel">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex min-h-touch w-full items-center gap-3 p-3 text-left"
        aria-expanded={aberto}
      >
        <span
          className={cn(
            'h-2 w-2 flex-shrink-0 rounded-full',
            e.lancou_hoje ? 'bg-ok' : e.ativa_semana ? 'bg-warn' : 'bg-on-surface-muted',
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-on-surface">{e.nome}</p>
          <p className="text-xs text-on-surface-dim">
            {e.lancou_hoje ? 'lançou hoje' : `último ${e.ultimo ? formatBR(e.ultimo) : '—'}`} ·{' '}
            {contar(Number(e.registros_7d ?? 0), 'lançamento', 'lançamentos')} em 7 dias ·{' '}
            {contar(Number(e.dias_30d ?? 0), 'dia', 'dias')} em 30 dias
          </p>
        </div>
        <ChevronDown
          className={cn(
            'h-5 w-5 flex-shrink-0 text-on-surface-muted transition-transform',
            aberto && 'rotate-180',
          )}
        />
      </button>
      {aberto && (
        <div className="border-t border-border px-3 pb-3 pt-2">
          {servicos.length === 0 ? (
            <p className="text-xs text-on-surface-dim">Sem produção nos últimos 30 dias.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="rotulo text-left">
                  <th className="pb-1 font-medium">Serviço</th>
                  <th className="pb-1 text-right font-medium">Hoje</th>
                  <th className="pb-1 text-right font-medium">7 dias</th>
                  <th className="pb-1 text-right font-medium">30 dias</th>
                  {comAderencia && (
                    <th
                      className="pb-1 text-right font-medium"
                      title="Mediana diária ÷ meta da composição"
                    >
                      Meta
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {servicos.map((s, i) => {
                  const ad = s.aderencia == null ? null : Number(s.aderencia)
                  // o nome ocupa a largura toda numa linha própria; os números ficam na linha de baixo
                  return (
                    <Fragment key={s.id}>
                      <tr className={i > 0 ? 'border-t border-border' : undefined}>
                        <th
                          scope="row"
                          colSpan={comAderencia ? 5 : 4}
                          className="pt-1.5 text-left font-normal text-on-surface"
                        >
                          <span className="tabular text-on-surface-dim">{s.codigo}</span>{' '}
                          {s.descricao}
                        </th>
                      </tr>
                      <tr>
                        <td className="pb-1.5 pr-2 text-2xs text-on-surface-muted">
                          {s.unidade} · {contar(Number(s.dias ?? 0), 'dia', 'dias')}
                        </td>
                        <td className="tabular pb-1.5 text-right">{qtd(s.hoje)}</td>
                        <td className="tabular pb-1.5 text-right">{qtd(s.d7)}</td>
                        <td className="tabular pb-1.5 text-right">{qtd(s.d30)}</td>
                        {comAderencia && (
                          <td
                            className={cn(
                              'tabular pb-1.5 text-right',
                              ad == null
                                ? 'text-on-surface-muted'
                                : ad >= 0.9 && ad <= 1.1
                                  ? 'text-ok'
                                  : ad >= 0.7 && ad <= 1.3
                                    ? 'text-warn'
                                    : 'text-bad',
                            )}
                          >
                            {ad == null ? '—' : pct(ad, 0)}
                          </td>
                        )}
                      </tr>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
          <Link
            to={`/painel/producao?${filtro}=${e.id ?? 'sem'}`}
            className="mt-1 inline-flex min-h-touch items-center text-sm font-medium text-accent"
          >
            Ver produção dia a dia
          </Link>
        </div>
      )}
    </li>
  )
}

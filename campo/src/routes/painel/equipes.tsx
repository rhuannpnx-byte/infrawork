import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { formatBR } from '@/lib/datas'
import { cn } from '@/lib/cn'
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
        className="grid grid-cols-2 rounded-md border border-border bg-bg-panel p-1"
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
              'rounded py-2 text-sm',
              aba === a ? 'bg-bg-elevated font-semibold text-on-surface' : 'text-on-surface-dim',
            )}
          >
            {a === 'equipes'
              ? `Equipes (${(p.equipes ?? []).length})`
              : `Encarregados (${(p.encarregados ?? []).length})`}
          </button>
        ))}
      </div>

      {semHoje.length > 0 && (
        <Secao titulo="Sem lançamento hoje" className="border-warn/40">
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
          <p className="mt-2 text-[10px] text-on-surface-muted">
            Trabalharam nesta semana e ainda não têm produção lançada hoje.
          </p>
        </Secao>
      )}

      {ordenada.length === 0 ? (
        <p className="py-8 text-center text-xs text-on-surface-muted">
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
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        <span
          className={cn(
            'h-2 w-2 flex-shrink-0 rounded-full',
            e.lancou_hoje ? 'bg-ok' : e.ativa_semana ? 'bg-warn' : 'bg-on-surface-muted',
          )}
          aria-label={e.lancou_hoje ? 'Lançou hoje' : 'Sem lançamento hoje'}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-on-surface">{e.nome}</p>
          <p className="text-[11px] text-on-surface-dim">
            {e.lancou_hoje ? 'lançou hoje' : `último ${e.ultimo ? formatBR(e.ultimo) : '—'}`} ·{' '}
            {e.registros_7d} lanç. em 7 d · {e.dias_30d} dia(s) em 30 d
          </p>
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-on-surface-muted transition-transform',
            aberto && 'rotate-180',
          )}
        />
      </button>
      {aberto && (
        <div className="border-t border-border px-3 pb-3 pt-2">
          {servicos.length === 0 ? (
            <p className="text-xs text-on-surface-muted">Sem produção nos últimos 30 dias.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-on-surface-muted">
                  <th className="pb-1 font-medium">Serviço</th>
                  <th className="pb-1 text-right font-medium">Hoje</th>
                  <th className="pb-1 text-right font-medium">7 d</th>
                  <th className="pb-1 text-right font-medium">30 d</th>
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
              <tbody className="divide-y divide-border">
                {servicos.map((s) => {
                  const ad = s.aderencia == null ? null : Number(s.aderencia)
                  return (
                    <tr key={s.id}>
                      <td className="max-w-0 py-1.5 pr-2">
                        <span className="block truncate text-on-surface">
                          <span className="font-mono text-on-surface-dim">{s.codigo}</span>{' '}
                          {s.descricao}
                        </span>
                        <span className="text-[10px] text-on-surface-muted">
                          {s.unidade} · {s.dias} dia(s)
                        </span>
                      </td>
                      <td className="py-1.5 text-right font-mono tabular">{qtd(s.hoje)}</td>
                      <td className="py-1.5 text-right font-mono tabular">{qtd(s.d7)}</td>
                      <td className="py-1.5 text-right font-mono tabular">{qtd(s.d30)}</td>
                      {comAderencia && (
                        <td
                          className={cn(
                            'py-1.5 text-right font-mono tabular',
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
                  )
                })}
              </tbody>
            </table>
          )}
          <Link
            to={`/painel/producao?${filtro}=${e.id ?? 'sem'}`}
            className="mt-2 inline-block text-xs text-accent"
          >
            Ver produção dia a dia
          </Link>
        </div>
      )}
    </li>
  )
}

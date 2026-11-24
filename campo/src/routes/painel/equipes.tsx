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
import { SeletorPeriodo } from '@/features/painel/SeletorPeriodo'
import { usePeriodo } from '@/features/painel/periodo'
import { producaoPorDono, SEM } from '@/features/painel/producao'

/** Uma linha da tabela do cartão: a produção de um serviço pela equipe (ou encarregado). */
interface LinhaServico {
  id: string
  codigo: string | null
  descricao: string | null
  unidade: string | null
  hoje: number | null
  total: number | null
  dias: number
  aderencia: number | null
}

/**
 * Visão estratégica › Equipes e encarregados: quem lançou hoje, a produção por serviço no período escolhido e a
 * aderência à meta.
 */
export function PainelEquipesRoute() {
  return <PainelShell titulo="Equipes e encarregados">{(p) => <Equipes p={p} />}</PainelShell>
}

function Equipes({ p }: { p: CatPainel }) {
  const [params, setParams] = useSearchParams()
  const aba = params.get('aba') === 'encarregados' ? 'encarregados' : 'equipes'
  const prod = p.producao ?? null
  const periodo = usePeriodo(p.hoje, prod?.desde ?? p.hoje)
  const doServidor = (aba === 'equipes' ? p.equipes : p.encarregados) ?? []
  const semHoje = semLancamentoHoje(doServidor)
  // produção do período pela produção diária; sem ela (retrato antigo) vale o resumo de 30 dias do servidor
  const porDono = prod
    ? producaoPorDono(prod, aba === 'equipes' ? 'e' : 'n', periodo.de, periodo.ate, p.hoje)
    : null
  // quem produziu no período e já saiu do resumo de 30 dias do servidor também aparece
  const conhecidos = new Set(doServidor.map((e) => e.id ?? SEM))
  const extras: PainelEquipeDto[] = porDono
    ? [...porDono]
        .filter(([id]) => !conhecidos.has(id))
        .map(([id, d]) => ({
          id: id === SEM ? null : id,
          nome:
            id === SEM
              ? aba === 'equipes'
                ? 'Sem equipe'
                : 'Sem encarregado'
              : ((aba === 'equipes' ? prod!.equipes : prod!.encarregados)[id] ?? '(removido)'),
          lancou_hoje: false,
          ativa_semana: false,
          dias_30d: 0,
          registros_7d: 0,
          ultimo: d.ultimo,
          servicos: null,
        }))
    : []
  const ordenada = [...doServidor, ...extras].sort(
    (a, b) =>
      Number(b.lancou_hoje) - Number(a.lancou_hoje) ||
      Number(b.ativa_semana) - Number(a.ativa_semana) ||
      (b.ultimo ?? '').localeCompare(a.ultimo ?? ''),
  )

  const linhasDe = (e: PainelEquipeDto): LinhaServico[] => {
    if (!porDono || !prod)
      return [...(e.servicos ?? [])]
        .sort((a, b) => Number(b.d30 ?? 0) - Number(a.d30 ?? 0))
        .map((s) => ({
          id: s.id,
          codigo: s.codigo,
          descricao: s.descricao,
          unidade: s.unidade,
          hoje: s.hoje,
          total: s.d30,
          dias: Number(s.dias ?? 0),
          aderencia: s.aderencia == null ? null : Number(s.aderencia),
        }))
    return (porDono.get(e.id ?? SEM)?.servicos ?? []).map((sv) => {
      const meta = prod.servicos[sv.servico]
      const srv = (e.servicos ?? []).find((x) => x.id === sv.servico)
      return {
        id: sv.servico,
        codigo: meta?.codigo ?? srv?.codigo ?? null,
        descricao: meta?.descricao ?? srv?.descricao ?? null,
        unidade: meta?.unidade ?? srv?.unidade ?? null,
        hoje: sv.hoje,
        total: sv.total,
        dias: sv.dias,
        aderencia: srv?.aderencia == null ? null : Number(srv.aderencia),
      }
    })
  }

  return (
    <div className="space-y-3">
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

      {prod && <SeletorPeriodo hoje={p.hoje} desde={prod.desde} />}

      {ordenada.length === 0 ? (
        <p className="py-8 text-center text-sm text-on-surface-dim">
          Nenhuma produção com {aba === 'equipes' ? 'equipe' : 'encarregado'}{' '}
          {prod ? 'no período' : 'nos últimos 30 dias'}.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="painel-equipes">
          {ordenada.map((e) => (
            <CartaoEquipe
              key={e.id ?? `sem-${e.nome}`}
              e={e}
              linhas={linhasDe(e)}
              diasNoPeriodo={porDono ? (porDono.get(e.id ?? SEM)?.dias ?? 0) : null}
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
  linhas,
  diasNoPeriodo,
  comAderencia,
  filtro,
}: {
  e: PainelEquipeDto
  linhas: LinhaServico[]
  /** dias com produção no período escolhido (null = retrato antigo: vale o resumo de 30 dias) */
  diasNoPeriodo: number | null
  comAderencia: boolean
  filtro: 'equipe' | 'encarregado'
}) {
  const [aberto, setAberto] = useState(false)
  const noPeriodo = diasNoPeriodo != null
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
            {noPeriodo
              ? diasNoPeriodo > 0
                ? `${contar(diasNoPeriodo, 'dia', 'dias')} com produção no período`
                : 'sem produção no período'
              : `${contar(Number(e.registros_7d ?? 0), 'lançamento', 'lançamentos')} em 7 dias · ${contar(Number(e.dias_30d ?? 0), 'dia', 'dias')} em 30 dias`}
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
          {linhas.length === 0 ? (
            <p className="text-xs text-on-surface-dim">
              {noPeriodo ? 'Sem produção no período.' : 'Sem produção nos últimos 30 dias.'}
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="rotulo text-left">
                  <th className="pb-1 font-medium">Serviço</th>
                  <th className="pb-1 text-right font-medium">Hoje</th>
                  <th className="pb-1 text-right font-medium">
                    {noPeriodo ? 'No período' : '30 dias'}
                  </th>
                  {comAderencia && (
                    <th
                      className="pb-1 text-right font-medium"
                      title="Mediana diária ÷ meta da composição, nos últimos 30 dias"
                    >
                      Meta
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {linhas.map((s, i) => {
                  const ad = s.aderencia
                  // o nome ocupa a largura toda numa linha própria; os números ficam na linha de baixo
                  return (
                    <Fragment key={s.id}>
                      <tr className={i > 0 ? 'border-t border-border' : undefined}>
                        <th
                          scope="row"
                          colSpan={comAderencia ? 4 : 3}
                          className="pt-1.5 text-left font-normal text-on-surface"
                        >
                          <span className="tabular text-on-surface-dim">{s.codigo}</span>{' '}
                          {s.descricao}
                        </th>
                      </tr>
                      <tr>
                        <td className="pb-1.5 pr-2 text-2xs text-on-surface-muted">
                          {s.unidade} · {contar(s.dias, 'dia', 'dias')}
                        </td>
                        <td className="tabular pb-1.5 text-right">{qtd(s.hoje)}</td>
                        <td className="tabular pb-1.5 text-right">{qtd(s.total)}</td>
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

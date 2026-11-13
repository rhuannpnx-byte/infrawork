import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { formatBR } from '@/lib/datas'
import { cn } from '@/lib/cn'
import type { CatPainel } from '@/core/db/entities'
import { Kpi, PainelShell, Secao } from '@/features/painel/PainelShell'
import { BarraAvanco, CurvaS } from '@/features/painel/graficos'
import {
  moeda,
  moedaCheia,
  ordenarServicos,
  pct,
  pctFinanceiro,
  qtd,
  semLancamentoHoje,
  serieCurva,
  statusInfo,
  TOM_TEXTO,
} from '@/features/painel/lib'

/** Visão estratégica › Resumo: avanço físico e financeiro, curva S, produção recente e o que pede atenção. */
export function PainelResumoRoute() {
  return <PainelShell titulo="Resumo da obra">{(p) => <Resumo p={p} />}</PainelShell>
}

function Resumo({ p }: { p: CatPainel }) {
  const r = p.resumo
  const f = p.financeiro
  const temPrevisto = p.referencia != null
  const desvioPp =
    r.avanco != null && r.esperado != null ? Number(r.avanco) - Number(r.esperado) : null
  const tomFisico =
    desvioPp == null ? 'accent' : desvioPp < -0.02 ? 'bad' : desvioPp < 0 ? 'warn' : 'ok'
  const pf = pctFinanceiro(f)
  const curva = serieCurva(p.curva ?? [], p.hoje)
  const atencao = ordenarServicos(p.servicos ?? []).filter(
    (s) => s.status === 'atrasado' || s.status === 'em_risco',
  )
  const semHoje = semLancamentoHoje(p.equipes ?? [])

  return (
    <div className="space-y-4">
      {!p.referencia ? (
        <Aviso>
          Sem linha de base vigente: o previsto e o esperado ficam vazios. A produção aparece
          normalmente.
        </Aviso>
      ) : !p.referencia.vigente ? (
        <Aviso>
          Usando a linha de base provisória "{p.referencia.nome}" (nenhuma está vigente).
        </Aviso>
      ) : null}

      <Secao titulo="Avanço físico">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p
              className={cn('text-4xl font-medium tabular', TOM_TEXTO[tomFisico])}
              data-testid="painel-avanco"
            >
              {pct(r.avanco)}
            </p>
            <p className="mt-1 text-xs text-on-surface-dim">
              {temPrevisto ? <>esperado hoje {pct(r.esperado)}</> : 'sem previsto'}
            </p>
          </div>
          {desvioPp != null && (
            <p className={cn('text-right font-mono text-sm tabular', TOM_TEXTO[tomFisico])}>
              {desvioPp >= 0 ? '+' : '−'}
              {Math.abs(desvioPp * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.
              <span className="block text-xs text-on-surface-dim">
                {desvioPp >= 0 ? 'à frente do plano' : 'atrás do plano'}
              </span>
            </p>
          )}
        </div>
        <BarraAvanco
          real={r.avanco}
          esperado={temPrevisto ? r.esperado : null}
          tom={tomFisico}
          className="mt-3"
        />
        <p className="mt-2 text-xs text-on-surface-muted">
          Ponderado pelo valor de venda de cada serviço.
        </p>
      </Secao>

      <Secao titulo="Valor agregado">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Kpi
            valor={moeda(f.executado)}
            legenda={`executado · ${pct(pf)} dos serviços`}
            testId="painel-executado"
          />
          <Kpi valor={moeda(f.executado_mes)} legenda="executado no mês" />
          <Kpi valor={temPrevisto ? moeda(f.previsto) : '—'} legenda="previsto até hoje" />
          <Kpi valor={moeda(f.contrato)} legenda="valor do contrato" />
        </div>
        {temPrevisto && Number(f.previsto) > 0 && (
          <p
            className={cn(
              'mt-3 text-xs',
              Number(f.executado) >= Number(f.previsto) ? 'text-ok' : 'text-warn',
            )}
          >
            {Number(f.executado) >= Number(f.previsto) ? 'Acima' : 'Abaixo'} do previsto em{' '}
            {moedaCheia(Math.abs(Number(f.executado) - Number(f.previsto)))}
          </p>
        )}
        {Number(f.servicos_alem_contrato) > 0 && (
          <p className="mt-2 text-xs text-warn">
            {Number(f.servicos_alem_contrato) === 1
              ? '1 serviço produziu'
              : `${f.servicos_alem_contrato} serviços produziram`}{' '}
            além da quantidade do contrato. O excedente não agrega valor.
          </p>
        )}
      </Secao>

      <Secao
        titulo="Curva S (acumulado semanal)"
        acao={
          <span className="flex items-center gap-3 text-2xs text-on-surface-dim">
            <span className="flex items-center gap-1">
              <span className="inline-block h-0 w-3 border-t border-dashed border-on-surface-dim" />
              previsto
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-3 bg-[var(--chart-real)]" />
              realizado
            </span>
          </span>
        }
      >
        <CurvaS pontos={curva.pontos} idxHoje={curva.idxHoje} />
      </Secao>

      <Secao titulo="Produção">
        <div className="grid grid-cols-3 gap-3">
          <Kpi
            valor={r.registros_hoje}
            legenda={`hoje · ${r.servicos_hoje} serv.`}
            testId="painel-registros-hoje"
          />
          <Kpi valor={r.registros_7d} legenda={`7 dias · ${r.servicos_7d} serv.`} />
          <Kpi valor={r.registros_30d} legenda={`30 dias · ${r.dias_30d} dias`} />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-on-surface-dim">
          <span>
            Equipes: <b className="text-on-surface">{r.equipes_hoje}</b> hoje ·{' '}
            <b className="text-on-surface">{r.equipes_7d}</b> na semana
          </span>
          <span>
            Último lançamento: {r.ultimo_lancamento ? formatBR(r.ultimo_lancamento) : '—'}
          </span>
        </div>
      </Secao>

      {(atencao.length > 0 || semHoje.length > 0) && (
        <Secao titulo="Pede atenção">
          <ul className="divide-y divide-border">
            {atencao.slice(0, 4).map((s) => {
              const st = statusInfo(s.status)
              return (
                <li key={s.id}>
                  <Link
                    to={`/painel/servicos/${s.id}`}
                    className="flex min-h-touch items-center gap-3 py-2.5"
                  >
                    <AlertTriangle className={cn('h-4 w-4 flex-shrink-0', TOM_TEXTO[st.tom])} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-on-surface">
                        <span className="font-mono text-on-surface-dim">{s.codigo}</span>{' '}
                        {s.descricao}
                      </p>
                      <p className={cn('text-xs', TOM_TEXTO[st.tom])}>
                        {st.label} · {pct(s.pct_avanco)} de {pct(s.pct_esperado)} esperado
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 flex-shrink-0 text-on-surface-muted" />
                  </Link>
                </li>
              )
            })}
            {semHoje.length > 0 && (
              <li>
                <Link to="/painel/equipes" className="flex min-h-touch items-center gap-3 py-2.5">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warn" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-on-surface">
                      {semHoje.length === 1
                        ? '1 equipe da semana sem lançamento hoje'
                        : `${semHoje.length} equipes da semana sem lançamento hoje`}
                    </p>
                    <p className="truncate text-xs text-on-surface-dim">
                      {semHoje
                        .slice(0, 3)
                        .map((e) => e.nome)
                        .join(', ')}
                      {semHoje.length > 3 ? '…' : ''}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 flex-shrink-0 text-on-surface-muted" />
                </Link>
              </li>
            )}
          </ul>
        </Secao>
      )}

      <UltimosLancamentos ultimos={p.ultimos ?? []} />
    </div>
  )
}

function UltimosLancamentos({ ultimos }: { ultimos: CatPainel['ultimos'] }) {
  const [todos, setTodos] = useState(false)
  const lista = todos ? ultimos : ultimos.slice(0, 8)
  return (
    <Secao
      titulo="Últimos lançamentos"
      acao={
        ultimos.length > 8 && (
          <button
            type="button"
            className="-my-3 inline-flex min-h-touch items-center px-1 text-sm font-medium text-accent"
            onClick={() => setTodos((v) => !v)}
          >
            {todos ? 'Ver menos' : `Ver os ${ultimos.length}`}
          </button>
        )
      }
    >
      {lista.length === 0 ? (
        <p className="text-xs text-on-surface-dim">Nenhum lançamento ainda.</p>
      ) : (
        <ul className="divide-y divide-border" data-testid="painel-ultimos">
          {lista.map((u, i) => (
            <li key={i} className="py-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate text-sm text-on-surface">
                  <span className="text-on-surface-dim tabular">{u.codigo}</span> {u.descricao}
                </p>
                <p className="flex-shrink-0 font-mono text-sm text-on-surface tabular">
                  {qtd(u.qtd, u.unidade)}
                </p>
              </div>
              <p className="truncate text-xs text-on-surface-dim">
                {formatBR(u.data)}
                {u.equipe ? ` · ${u.equipe}` : ''}
                {u.encarregado ? ` · ${u.encarregado}` : ''}
                {u.estacas ? ` · ${u.estacas}` : ''}
                {u.por ? ` · por ${u.por}` : ''}
                {ORIGEM[u.origem] ? ` · ${ORIGEM[u.origem]}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Secao>
  )
}

/** De onde veio o lançamento ('campo' é o padrão do app e não precisa de rótulo). */
const ORIGEM: Record<string, string> = { app: 'web', importacao: 'importado', viagens: 'viagens' }

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-md border border-warn/50 bg-warn/10 p-3 text-xs text-on-surface">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warn" aria-hidden />
      <p>{children}</p>
    </div>
  )
}

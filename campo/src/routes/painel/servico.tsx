import { Link, useParams } from 'react-router-dom'
import { formatBR } from '@/lib/datas'
import { cn } from '@/lib/cn'
import type { CatPainel } from '@/core/db/entities'
import { Kpi, PainelShell, Secao } from '@/features/painel/PainelShell'
import { Barras14, BarraAvanco } from '@/features/painel/graficos'
import { moeda, pct, qtd, statusInfo, textoDesvio, TOM_TEXTO } from '@/features/painel/lib'
import { SeletorPeriodo } from '@/features/painel/SeletorPeriodo'
import { usePeriodo } from '@/features/painel/periodo'
import { producaoPorDono, SEM } from '@/features/painel/producao'

/**
 * Visão estratégica › Serviço: avanço (contrato, previsto até hoje e realizado, em quantidade), ritmo, produção dos
 * 14 dias, valor agregado e quem produziu no período escolhido.
 */
export function PainelServicoRoute() {
  const { id } = useParams()
  return (
    <PainelShell titulo="Serviço" voltarPara="/painel/servicos" semAbas>
      {(p) => <Servico p={p} id={id ?? ''} />}
    </PainelShell>
  )
}

function Servico({ p, id }: { p: CatPainel; id: string }) {
  const prod = p.producao ?? null
  const periodo = usePeriodo(p.hoje, prod?.desde ?? p.hoje)
  const s = (p.servicos ?? []).find((x) => x.id === id)
  if (!s)
    return (
      <p className="mt-10 text-center text-sm text-on-surface-dim">
        Serviço não encontrado nesta obra (pode ter saído do orçamento). Volte e atualize.
      </p>
    )
  const st = statusInfo(s.status)
  const dv = textoDesvio(s.desvio_dias)
  const ritmo = s.ritmo_plan != null ? Number(s.ritmo_plan) : null
  const media = s.media_7d != null ? Number(s.media_7d) : null
  const tomRitmo =
    ritmo && media != null
      ? media >= ritmo
        ? 'ok'
        : media >= 0.8 * ritmo
          ? 'warn'
          : 'bad'
      : 'muted'
  // previsto em quantidade: a fração esperada para hoje (da linha de base) sobre a quantidade do contrato
  const qtdPrevista =
    s.qtd_plan != null && s.pct_esperado != null
      ? Number(s.qtd_plan) * Number(s.pct_esperado)
      : null
  // quem produziu o serviço no período escolhido (equipes e encarregados), pela produção diária
  const quem = prod
    ? (['e', 'n'] as const)
        .flatMap((campo) =>
          [...producaoPorDono(prod, campo, periodo.de, periodo.ate, p.hoje)].map(([dono, d]) => ({
            tipo: campo === 'e' ? 'Equipe' : 'Encarregado',
            nome:
              dono === SEM
                ? campo === 'e'
                  ? 'Sem equipe'
                  : 'Sem encarregado'
                : ((campo === 'e' ? prod.equipes : prod.encarregados)[dono] ?? '(removido)'),
            sv: d.servicos.find((x) => x.servico === id),
          })),
        )
        .filter((x) => x.sv && x.sv.total > 0)
        .sort((a, b) => a.tipo.localeCompare(b.tipo) || b.sv!.total - a.sv!.total)
    : []

  return (
    <div className="space-y-3">
      <div>
        <p className="tabular text-sm text-on-surface-dim">{s.codigo}</p>
        <h2 className="text-base font-semibold text-on-surface">{s.descricao}</h2>
        <p className="mt-1 text-xs">
          <span className={TOM_TEXTO[st.tom]}>{st.label}</span>
          {dv && <span className={TOM_TEXTO[dv.tom]}> · {dv.texto}</span>}
        </p>
      </div>

      <Secao titulo="Avanço">
        <div className="flex items-end justify-between gap-3">
          <p
            className={cn('tabular text-3xl font-medium', TOM_TEXTO[st.tom])}
            data-testid="servico-avanco"
          >
            {pct(s.pct_avanco)}
          </p>
          <p className="text-right text-xs text-on-surface-dim">
            esperado hoje <span className="tabular text-on-surface">{pct(s.pct_esperado)}</span>
          </p>
        </div>
        <BarraAvanco real={s.pct_avanco} esperado={s.pct_esperado} tom={st.tom} className="mt-3" />
        {/* à esquerda as quantidades (contrato, previsto até hoje, realizado); à direita as datas do plano */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="space-y-3">
            <Kpi
              valor={qtd(s.qtd_plan, s.unidade)}
              legenda="do contrato"
              testId="servico-contrato"
            />
            <Kpi
              valor={qtd(qtdPrevista, s.unidade)}
              legenda="previsto até hoje"
              testId="servico-previsto"
            />
            <Kpi
              valor={qtd(s.qtd_real, s.unidade)}
              legenda="realizado"
              testId="servico-realizado"
            />
          </div>
          <div className="space-y-3">
            <Kpi valor={s.inicio ? formatBR(s.inicio) : '—'} legenda="início previsto" />
            <Kpi valor={s.fim ? formatBR(s.fim) : '—'} legenda="término previsto" />
          </div>
        </div>
        {s.excedente_qtd != null && Number(s.excedente_qtd) > 0 && (
          <p className="mt-3 text-xs text-warn">
            Produziu {qtd(s.excedente_qtd, s.unidade)} além do contrato. O excedente não agrega
            valor.
          </p>
        )}
      </Secao>

      <Secao
        titulo="Ritmo"
        acao={
          <Link
            to={`/painel/producao?servico=${s.id}`}
            className="-my-3 inline-flex min-h-touch items-center px-1 text-sm font-medium text-accent"
            data-testid="servico-dia-a-dia"
          >
            Ver dia a dia
          </Link>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Kpi
            valor={<span className={TOM_TEXTO[tomRitmo]}>{qtd(media, s.unidade)}</span>}
            legenda="média/dia nos últimos 7 d"
          />
          <Kpi valor={qtd(ritmo, s.unidade)} legenda="ritmo do plano/dia" />
        </div>
        <div className="mt-4">
          <Barras14 valores={s.dias14 ?? []} unidade={s.unidade} />
        </div>
      </Secao>

      <Secao titulo="Valor agregado">
        <div className="grid grid-cols-2 gap-3">
          <Kpi valor={moeda(s.valor_executado)} legenda="executado" testId="servico-valor" />
          <Kpi valor={p.referencia ? moeda(s.valor_previsto) : '—'} legenda="previsto até hoje" />
        </div>
      </Secao>

      <Secao titulo="Quem produziu">
        {prod && (
          <div className="mb-3">
            <SeletorPeriodo hoje={p.hoje} desde={prod.desde} />
          </div>
        )}
        {quem.length === 0 ? (
          <p className="text-xs text-on-surface-dim">
            {prod
              ? 'Sem produção deste serviço no período.'
              : 'A produção diária ainda não veio do servidor. Toque em atualizar.'}
          </p>
        ) : (
          <table className="w-full text-xs" data-testid="servico-quem">
            <thead>
              <tr className="rotulo text-left">
                <th className="pb-1 font-medium">Nome</th>
                <th className="pb-1 text-right font-medium">Hoje</th>
                <th className="pb-1 text-right font-medium">No período</th>
                <th className="pb-1 text-right font-medium">Dias</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {quem.map((q, i) => (
                <tr key={i}>
                  <td className="py-1.5 pr-2">
                    <span className="text-on-surface">{q.nome}</span>
                    <span className="block text-2xs text-on-surface-muted">{q.tipo}</span>
                  </td>
                  <td className="tabular py-1.5 text-right font-mono">{qtd(q.sv!.hoje)}</td>
                  <td className="tabular py-1.5 text-right font-mono">{qtd(q.sv!.total)}</td>
                  <td className="tabular py-1.5 text-right font-mono">{q.sv!.dias}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Secao>
    </div>
  )
}

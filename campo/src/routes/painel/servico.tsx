import { Link, useParams } from 'react-router-dom'
import { formatBR } from '@/lib/datas'
import { cn } from '@/lib/cn'
import type { CatPainel } from '@/core/db/entities'
import { Kpi, PainelShell, Secao } from '@/features/painel/PainelShell'
import { Barras14, BarraAvanco } from '@/features/painel/graficos'
import { moeda, pct, qtd, statusInfo, textoDesvio, TOM_TEXTO } from '@/features/painel/lib'

/** Visão estratégica › Serviço: avanço, ritmo, produção dos 14 dias, quem produziu e o valor agregado. */
export function PainelServicoRoute() {
  const { id } = useParams()
  return (
    <PainelShell titulo="Serviço" voltarPara="/painel/servicos" semAbas>
      {(p) => <Servico p={p} id={id ?? ''} />}
    </PainelShell>
  )
}

function Servico({ p, id }: { p: CatPainel; id: string }) {
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
  const quem = [
    ...(p.equipes ?? []).map((e) => ({ tipo: 'Equipe', e })),
    ...(p.encarregados ?? []).map((e) => ({ tipo: 'Encarregado', e })),
  ]
    .map(({ tipo, e }) => ({ tipo, nome: e.nome, sv: (e.servicos ?? []).find((x) => x.id === id) }))
    .filter((x) => x.sv && Number(x.sv.d30 ?? 0) > 0)

  return (
    <div className="space-y-4">
      <div>
        <p className="font-mono text-sm text-on-surface-dim">{s.codigo}</p>
        <h2 className="text-base font-semibold text-on-surface">{s.descricao}</h2>
        <p className="mt-1 text-xs">
          <span className={TOM_TEXTO[st.tom]}>{st.label}</span>
          {dv && <span className={TOM_TEXTO[dv.tom]}> · {dv.texto}</span>}
        </p>
      </div>

      <Secao titulo="Avanço">
        <div className="flex items-end justify-between gap-3">
          <p
            className={cn('font-mono text-3xl tabular', TOM_TEXTO[st.tom])}
            data-testid="servico-avanco"
          >
            {pct(s.pct_avanco)}
          </p>
          <p className="text-right text-xs text-on-surface-dim">
            esperado hoje <span className="font-mono text-on-surface">{pct(s.pct_esperado)}</span>
          </p>
        </div>
        <BarraAvanco real={s.pct_avanco} esperado={s.pct_esperado} tom={st.tom} className="mt-3" />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Kpi valor={qtd(s.qtd_real, s.unidade)} legenda="realizado" />
          <Kpi valor={qtd(s.qtd_plan, s.unidade)} legenda="do contrato" />
          <Kpi valor={s.inicio ? formatBR(s.inicio) : '—'} legenda="início planejado" />
          <Kpi valor={s.fim ? formatBR(s.fim) : '—'} legenda="término planejado" />
        </div>
        {s.excedente_qtd != null && Number(s.excedente_qtd) > 0 && (
          <p className="mt-3 text-xs text-warn">
            Produziu {qtd(s.excedente_qtd, s.unidade)} além do contrato — o excedente não agrega
            valor.
          </p>
        )}
      </Secao>

      <Secao
        titulo="Ritmo"
        acao={
          <Link
            to={`/painel/producao?servico=${s.id}`}
            className="text-xs text-accent"
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

      <Secao titulo="Quem produziu (30 dias)">
        {quem.length === 0 ? (
          <p className="text-xs text-on-surface-muted">Sem produção nos últimos 30 dias.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-on-surface-muted">
                <th className="pb-1 font-medium">Nome</th>
                <th className="pb-1 text-right font-medium">Hoje</th>
                <th className="pb-1 text-right font-medium">7 d</th>
                <th className="pb-1 text-right font-medium">30 d</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {quem.map((q, i) => (
                <tr key={i}>
                  <td className="py-1.5 pr-2">
                    <span className="text-on-surface">{q.nome}</span>
                    <span className="block text-[10px] text-on-surface-muted">{q.tipo}</span>
                  </td>
                  <td className="py-1.5 text-right font-mono tabular">{qtd(q.sv!.hoje)}</td>
                  <td className="py-1.5 text-right font-mono tabular">{qtd(q.sv!.d7)}</td>
                  <td className="py-1.5 text-right font-mono tabular">{qtd(q.sv!.d30)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Secao>
    </div>
  )
}

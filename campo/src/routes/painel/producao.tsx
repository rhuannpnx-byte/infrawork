import { useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatBR } from '@/lib/datas'
import type { CatPainel } from '@/core/db/entities'
import type { PainelProducaoDto } from '@/types/dtos'
import { PickerField } from '@/features/common/fields'
import { PickerSheet } from '@/features/common/PickerSheet'
import { Kpi, PainelShell, Secao } from '@/features/painel/PainelShell'
import { MapaCalor } from '@/features/painel/graficos'
import { qtd } from '@/features/painel/lib'
import { SeletorPeriodo } from '@/features/painel/SeletorPeriodo'
import { diasDoMes, mesesDoPeriodo, nomeDoMes, usePeriodo } from '@/features/painel/periodo'
import {
  detalheDoDia,
  eixoDias,
  encarregadosDoServico,
  equipesDoFiltro,
  producaoPorDia,
  resumoProducao,
  servicosComProducao,
  type FiltroProducao,
  type Opcao,
  type OpcaoServico,
} from '@/features/painel/producao'

const TODOS = { id: '', nome: 'Todos', total: 0 } satisfies Opcao

const fmtDia = (iso: string) => iso.split('-').reverse().join('/').slice(0, 5)
const nomeServico = (s: OpcaoServico) =>
  [s.codigo, s.descricao].filter(Boolean).join(' · ') || 'Serviço removido'

/**
 * Visão estratégica › Produção: a produção diária no período escolhido, por serviço, encarregado e equipe, e o mapa
 * de calor de um mês de calendário por vez.
 */
export function PainelProducaoRoute() {
  return <PainelShell titulo="Produção diária">{(p) => <Producao p={p} />}</PainelShell>
}

function Producao({ p }: { p: CatPainel }) {
  if (!p.producao)
    return (
      <p className="mt-10 text-center text-sm text-on-surface-dim">
        A produção diária ainda não veio do servidor. Toque em atualizar.
      </p>
    )
  return <ProducaoComDados prod={p.producao} hoje={p.hoje} />
}

function ProducaoComDados({ prod, hoje }: { prod: PainelProducaoDto; hoje: string }) {
  const [params, setParams] = useSearchParams()
  const periodo = usePeriodo(hoje, prod.desde)
  // só as linhas do período: os totais, as listas dos filtros e o mapa somam o que foi escolhido
  const noPeriodo = useMemo(
    () => ({ ...prod, dias: prod.dias.filter((l) => l.d >= periodo.de && l.d <= periodo.ate) }),
    [prod, periodo.de, periodo.ate],
  )
  const encarregado = params.get('encarregado')
  const equipe = params.get('equipe')
  const servicosFiltro = useMemo(
    () => servicosComProducao(noPeriodo, { encarregado, equipe }),
    [noPeriodo, encarregado, equipe],
  )
  // o serviço escolhido continua escolhido mesmo sem produção no período (os números zeram, a escolha não muda)
  const todosServicos = useMemo(() => servicosComProducao(prod), [prod])
  const servicoParam = params.get('servico')
  const servico =
    todosServicos.find((s) => s.id === servicoParam) ??
    servicosFiltro[0] ??
    todosServicos[0] ??
    null

  const encarregados = useMemo(
    () => encarregadosDoServico(noPeriodo, servico?.id ?? null),
    [noPeriodo, servico],
  )
  const equipes = useMemo(
    () => equipesDoFiltro(noPeriodo, servico?.id ?? null, encarregado),
    [noPeriodo, servico, encarregado],
  )
  const encSel = encarregados.find((o) => o.id === encarregado) ?? null
  const eqSel = equipes.find((o) => o.id === equipe) ?? null
  const sId = servico?.id ?? null
  const nId = encSel?.id ?? null
  const eId = eqSel?.id ?? null
  const filtro: FiltroProducao = useMemo(
    () => ({ servico: sId, encarregado: nId, equipe: eId }),
    [sId, nId, eId],
  )

  const mudar = (novo: Partial<Record<'servico' | 'encarregado' | 'equipe', string | null>>) => {
    const q = new URLSearchParams(params)
    for (const [k, v] of Object.entries(novo)) {
      if (v) q.set(k, v)
      else q.delete(k)
    }
    setParams(q, { replace: true })
  }

  const dias = useMemo(() => eixoDias(periodo.de, periodo.ate), [periodo.de, periodo.ate])
  const porDia = useMemo(() => producaoPorDia(noPeriodo, filtro), [noPeriodo, filtro])
  const resumo = resumoProducao(porDia, dias)
  const max = resumo.melhor?.q ?? 0

  // o mapa mostra um mês de calendário por vez (0 = o mais recente do período)
  const meses = useMemo(() => mesesDoPeriodo(periodo), [periodo])
  // o mês e o dia tocado valem para o período e o filtro em que foram escolhidos: mudou um deles, volta ao mais
  // recente (guardar a chave junto evita mostrar por um instante o mês da escolha anterior)
  const chave = `${periodo.de}|${periodo.ate}|${sId}|${nId}|${eId}`
  const [nav, setNav] = useState<{ chave: string; recuo: number; dia: string | null }>({
    chave,
    recuo: 0,
    dia: null,
  })
  const recuo = nav.chave === chave ? nav.recuo : 0
  const diaSel = nav.chave === chave ? nav.dia : null
  const setRecuo = (f: (atual: number) => number) => setNav({ chave, recuo: f(recuo), dia: null })
  const setDiaSel = (f: (atual: string | null) => string | null) =>
    setNav({ chave, recuo, dia: f(diaSel) })

  const mes = meses[Math.max(0, meses.length - 1 - recuo)] ?? hoje.slice(0, 7)
  const diasMes = useMemo(() => diasDoMes(mes), [mes])
  const detalhe = diaSel ? detalheDoDia(noPeriodo, filtro, diaSel) : []
  const qDia = diaSel ? (porDia.get(diaSel) ?? 0) : 0

  const [picker, setPicker] = useState<'servico' | 'encarregado' | 'equipe' | null>(null)
  const un = servico?.unidade ?? null

  if (!servico)
    return (
      <p className="mt-10 text-center text-sm text-on-surface-dim">
        Nenhuma produção lançada desde {formatBR(prod.desde)}.
      </p>
    )

  return (
    <div className="space-y-3">
      <SeletorPeriodo hoje={hoje} desde={prod.desde} />
      <div className="space-y-3">
        <PickerField
          label="Serviço"
          value={`${nomeServico(servico)}${un ? ` (${un})` : ''}`}
          onClick={() => setPicker('servico')}
        />
        <div className="grid grid-cols-2 gap-3">
          <PickerField
            label="Encarregado"
            value={encSel?.nome ?? 'Todos'}
            onClick={() => setPicker('encarregado')}
          />
          <PickerField
            label="Equipe"
            value={eqSel?.nome ?? 'Todas'}
            onClick={() => setPicker('equipe')}
          />
        </div>
      </div>

      <Secao titulo="No período">
        <div className="grid grid-cols-2 gap-3">
          <Kpi valor={qtd(resumo.total, un)} legenda="produzido" testId="producao-total" />
          <Kpi valor={resumo.diasCom} legenda="dias com produção" testId="producao-dias" />
          <Kpi valor={qtd(resumo.media, un)} legenda="média por dia trabalhado" />
          <Kpi
            valor={resumo.melhor ? qtd(resumo.melhor.q, un) : '—'}
            legenda={resumo.melhor ? `melhor dia (${fmtDia(resumo.melhor.d)})` : 'melhor dia'}
          />
        </div>
      </Secao>

      <Secao
        titulo="Mapa de calor"
        acao={
          <div className="flex items-center gap-1">
            <span
              className="mr-1 text-xs text-on-surface first-letter:uppercase"
              data-testid="mapa-calor-mes"
            >
              {nomeDoMes(mes)}
            </span>
            <BotaoJanela
              rotulo="Mês anterior"
              motivo="O período escolhido começa neste mês"
              disabled={recuo >= meses.length - 1}
              onClick={() => setRecuo((o) => o + 1)}
            >
              <ChevronLeft className="h-5 w-5" />
            </BotaoJanela>
            <BotaoJanela
              rotulo="Mês seguinte"
              motivo="Este já é o último mês do período"
              disabled={recuo === 0}
              onClick={() => setRecuo((o) => Math.max(0, o - 1))}
            >
              <ChevronRight className="h-5 w-5" />
            </BotaoJanela>
          </div>
        }
      >
        <MapaCalor
          porDia={porDia}
          dias={diasMes}
          max={max}
          noPeriodo={(d) => d >= periodo.de && d <= periodo.ate}
          selecionado={diaSel}
          onSelecionar={(d) => setDiaSel((cur) => (cur === d ? null : d))}
        />
        <div className="mt-3 border-t border-border pt-3 text-xs" data-testid="producao-detalhe">
          {!diaSel ? (
            <p className="text-on-surface-dim">Toque num dia para ver quem produziu.</p>
          ) : qDia <= 0 ? (
            <p className="text-on-surface-dim">{fmtDia(diaSel)}: sem produção.</p>
          ) : (
            <>
              <p className="text-on-surface">
                {fmtDia(diaSel)}: <span className="tabular font-semibold">{qtd(qDia, un)}</span>
              </p>
              <ul className="mt-1.5 space-y-1">
                {detalhe.map((o) => (
                  <li key={o.id} className="flex justify-between gap-2">
                    <span className="truncate text-on-surface-dim">{o.nome}</span>
                    <span className="tabular flex-shrink-0 text-on-surface">
                      {qtd(o.total, un)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </Secao>

      <PickerSheet
        open={picker === 'servico'}
        title="Serviço"
        items={servicosFiltro.length ? servicosFiltro : todosServicos}
        label={nomeServico}
        sublabel={(s) =>
          `${qtd(s.total, s.unidade)} ${servicosFiltro.length ? 'no período' : `desde ${fmtDia(prod.desde)}`} · último ${fmtDia(s.ultimo)}`
        }
        onPick={(s) => {
          const encOk = !nId || encarregadosDoServico(noPeriodo, s.id).some((o) => o.id === nId)
          const eqOk =
            !eId || equipesDoFiltro(noPeriodo, s.id, encOk ? nId : null).some((o) => o.id === eId)
          mudar({ servico: s.id, encarregado: encOk ? nId : null, equipe: eqOk ? eId : null })
          setPicker(null)
        }}
        onDismiss={() => setPicker(null)}
      />
      <PickerSheet
        open={picker === 'encarregado'}
        title="Encarregado"
        items={[TODOS, ...encarregados]}
        label={(o) => o.nome}
        sublabel={(o) => (o.id ? qtd(o.total, un) : null)}
        onPick={(o) => {
          const fica =
            !o.id || equipesDoFiltro(noPeriodo, servico.id, o.id).some((e) => e.id === eId)
          mudar({ servico: servico.id, encarregado: o.id || null, equipe: fica ? eId : null })
          setPicker(null)
        }}
        onDismiss={() => setPicker(null)}
      />
      <PickerSheet
        open={picker === 'equipe'}
        title="Equipe"
        items={[{ ...TODOS, nome: 'Todas' }, ...equipes]}
        label={(o) => o.nome}
        sublabel={(o) => (o.id ? qtd(o.total, un) : null)}
        onPick={(o) => {
          mudar({ servico: servico.id, equipe: o.id || null })
          setPicker(null)
        }}
        onDismiss={() => setPicker(null)}
      />
    </div>
  )
}

function BotaoJanela({
  rotulo,
  motivo,
  disabled,
  onClick,
  children,
}: {
  rotulo: string
  /** por que está desabilitado */
  motivo: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={rotulo}
      title={disabled ? motivo : rotulo}
      className={cn(
        'flex h-11 w-11 items-center justify-center rounded border border-border-strong',
        disabled ? 'opacity-40' : 'text-on-surface hover:border-accent',
      )}
    >
      {children}
    </button>
  )
}

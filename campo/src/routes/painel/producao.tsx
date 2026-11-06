import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { CatPainel } from '@/core/db/entities'
import type { PainelProducaoDto } from '@/types/dtos'
import { PickerField } from '@/features/common/fields'
import { PickerSheet } from '@/features/common/PickerSheet'
import { Kpi, PainelShell, Secao } from '@/features/painel/PainelShell'
import { MapaCalor } from '@/features/painel/graficos'
import { qtd } from '@/features/painel/lib'
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

const JANELA = 30
const TODOS = { id: '', nome: 'Todos', total: 0 } satisfies Opcao

const fmtDia = (iso: string) => iso.split('-').reverse().join('/').slice(0, 5)
const nomeServico = (s: OpcaoServico) =>
  [s.codigo, s.descricao].filter(Boolean).join(' — ') || '(serviço removido)'

/** Visão estratégica › Produção: mapa de calor da produção diária, por serviço, encarregado e equipe. */
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
  const encarregado = params.get('encarregado')
  const equipe = params.get('equipe')
  const servicosFiltro = useMemo(
    () => servicosComProducao(prod, { encarregado, equipe }),
    [prod, encarregado, equipe],
  )
  const todosServicos = useMemo(() => servicosComProducao(prod), [prod])
  const servicoParam = params.get('servico')
  const servico =
    todosServicos.find((s) => s.id === servicoParam) ??
    servicosFiltro[0] ??
    todosServicos[0] ??
    null

  const encarregados = useMemo(
    () => encarregadosDoServico(prod, servico?.id ?? null),
    [prod, servico],
  )
  const equipes = useMemo(
    () => equipesDoFiltro(prod, servico?.id ?? null, encarregado),
    [prod, servico, encarregado],
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

  const dias = useMemo(() => eixoDias(prod.desde, hoje), [prod.desde, hoje])
  const porDia = useMemo(() => producaoPorDia(prod, filtro), [prod, filtro])
  const resumo = resumoProducao(porDia, dias)
  const max = resumo.melhor?.q ?? 0

  const [offset, setOffset] = useState(0)
  const [diaSel, setDiaSel] = useState<string | null>(null)
  useEffect(() => {
    setOffset(0)
    setDiaSel(null)
  }, [filtro])

  const totalJanelas = Math.max(1, Math.ceil(dias.length / JANELA))
  const fim = dias.length - offset * JANELA
  const janela = dias.slice(Math.max(0, fim - JANELA), fim)
  const detalhe = diaSel ? detalheDoDia(prod, filtro, diaSel) : []
  const qDia = diaSel ? (porDia.get(diaSel) ?? 0) : 0

  const [picker, setPicker] = useState<'servico' | 'encarregado' | 'equipe' | null>(null)
  const un = servico?.unidade ?? null

  if (!servico)
    return (
      <p className="mt-10 text-center text-sm text-on-surface-dim">
        Nenhuma produção lançada nos últimos 90 dias.
      </p>
    )

  return (
    <div className="space-y-4">
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

      <Secao titulo="Últimos 90 dias">
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
            <span className="mr-1 font-mono text-[10px] text-on-surface-muted">
              {janela.length ? `${fmtDia(janela[0]!)} – ${fmtDia(janela[janela.length - 1]!)}` : ''}
            </span>
            <BotaoJanela
              rotulo="30 dias anteriores"
              disabled={offset >= totalJanelas - 1}
              onClick={() => setOffset((o) => o + 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </BotaoJanela>
            <BotaoJanela
              rotulo="30 dias seguintes"
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </BotaoJanela>
          </div>
        }
      >
        <MapaCalor
          porDia={porDia}
          dias={janela}
          max={max}
          selecionado={diaSel}
          onSelecionar={(d) => setDiaSel((cur) => (cur === d ? null : d))}
        />
        <div className="mt-3 border-t border-border pt-3 text-xs" data-testid="producao-detalhe">
          {!diaSel ? (
            <p className="text-on-surface-muted">Toque num dia para ver quem produziu.</p>
          ) : qDia <= 0 ? (
            <p className="text-on-surface-dim">{fmtDia(diaSel)} — sem produção.</p>
          ) : (
            <>
              <p className="text-on-surface">
                {fmtDia(diaSel)} — <span className="font-mono">{qtd(qDia, un)}</span>
              </p>
              <ul className="mt-1.5 space-y-1">
                {detalhe.map((o) => (
                  <li key={o.id} className="flex justify-between gap-2">
                    <span className="truncate text-on-surface-dim">{o.nome}</span>
                    <span className="flex-shrink-0 font-mono text-on-surface tabular">
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
        sublabel={(s) => `${qtd(s.total, s.unidade)} em 90 dias · último ${fmtDia(s.ultimo)}`}
        onPick={(s) => {
          const encOk = !nId || encarregadosDoServico(prod, s.id).some((o) => o.id === nId)
          const eqOk =
            !eId || equipesDoFiltro(prod, s.id, encOk ? nId : null).some((o) => o.id === eId)
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
          const fica = !o.id || equipesDoFiltro(prod, servico.id, o.id).some((e) => e.id === eId)
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
  disabled,
  onClick,
  children,
}: {
  rotulo: string
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
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded border border-border',
        disabled ? 'text-on-surface-muted/40' : 'text-on-surface hover:bg-bg-elevated',
      )}
    >
      {children}
    </button>
  )
}

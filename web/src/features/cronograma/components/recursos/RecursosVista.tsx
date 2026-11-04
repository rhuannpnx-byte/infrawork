/**
 * Visão de recursos — a `ResourceView` do ApeX no visual do InfraWork: o uso de cada recurso das equipes ao longo do
 * tempo (calculado pelo motor, já com o nivelamento), empilhado para os recursos marcados na legenda, com o eixo de
 * unidades no pico e o limite de cada recurso; abaixo, a ocupação das equipes nomeadas (recursos identificados).
 */
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Calendar } from '@apex/calendar'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { CalculoCronograma } from '../../hooks/calculo'
import { useExcluirLimite, useSalvarLimite } from '../../hooks/edicao'
import {
  calendarioInterface,
  DIA,
  EixoTempo,
  HORA,
  niveisCabecalho,
  periodosNaoUteis
} from '../../visoes/eixo'
import { Acumulado, empilhar, horasTrabalhadas, type Faixa } from '../../visoes/recursos'
import { coresServicos, fmtDataHora, fmtDataLonga, fmtNum, PALETA } from '../../visoes/formato'
import { lerNumero } from '../campos-util'
import { DicaFlutuante, type ConteudoDica } from '../DicaFlutuante'

const LEGENDA = 300
const EIXO_Y = 44
const CAB = 44
const LINHA_EQUIPE = 26

interface RecursoInfo {
  id: string
  nome: string
  grupo: string
  spans: Faixa[]
  pico: number
  horas: number
  cor: string
  limite: { id: string | null; maximo: number } | null
}

interface Props {
  calc: CalculoCronograma
  somenteLeitura: boolean
  mostrar: ReadonlySet<string>
  onMostrar: (ids: string[]) => void
  onAbrirTarefa: (id: string) => void
  pxPorHora: number | null
}

const NOME_GRUPO: Record<string, string> = {
  MVE: 'Equipamentos',
  EQUIPAMENTO: 'Equipamentos',
  MO: 'Mão de obra'
}

export function RecursosVista({
  calc,
  somenteLeitura,
  mostrar,
  onMostrar,
  onAbrirTarefa,
  pxPorHora
}: Props): ReactNode {
  const { entrada: e, resultado: r } = calc
  const ref = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState({ w: 1000, h: 600 })
  const [vista, setVista] = useState(0)
  const [mira, setMira] = useState<{ x: number; cx: number; cy: number } | null>(null)
  const [dicaEq, setDicaEq] = useState<{ x: number; y: number; conteudo: ConteudoDica } | null>(
    null
  )
  const salvarLimite = useSalvarLimite()
  const excluirLimite = useExcluirLimite()
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const medir = (): void => setArea({ w: el.clientWidth, h: el.clientHeight })
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const spec = r ? r.calendarios[r.calendarioPadraoId] : undefined
  const global = useMemo(() => (spec ? new Calendar(spec) : null), [spec])

  // ── recursos com uso, na ordem de nome dentro do grupo ──
  const recursos = useMemo((): RecursoInfo[] => {
    if (!e || !r || !global) return []
    const info = new Map<string, { nome: string; grupo: string }>()
    for (const q of e.equipes)
      for (const x of q.recursos) info.set(x.recurso_id, { nome: x.nome, grupo: x.grupo ?? '' })
    const lista = r.recursos.map((x) => {
      const spans = x.spans.map(([b, e2, q]) => ({ b, e: e2, q }))
      const i = info.get(x.recurso_id)
      const lim = e.limites.find((l) => l.recurso_id === x.recurso_id && l.grupo_id === null)
      return {
        id: x.recurso_id,
        nome: i?.nome ?? 'Recurso',
        grupo: i?.grupo ?? '',
        spans,
        pico: spans.reduce((m, s) => Math.max(m, s.q), 0),
        horas: horasTrabalhadas(spans, global),
        cor: '',
        limite: lim ? { id: lim.id ?? null, maximo: lim.maximo } : null
      }
    })
    lista.sort(
      (a, b) =>
        (NOME_GRUPO[a.grupo] ?? a.grupo).localeCompare(NOME_GRUPO[b.grupo] ?? b.grupo, 'pt-BR') ||
        a.nome.localeCompare(b.nome, 'pt-BR')
    )
    lista.forEach((x, k) => (x.cor = PALETA[k % PALETA.length]!))
    return lista
  }, [e, r, global])
  const mostrados = recursos.filter((x) => mostrar.has(x.id))

  // ── eixo do tempo (o calendário de interface sem fins de semana, como na ResourceView) ──
  const periodo = useMemo(() => {
    if (!r || r.fimProjeto === null) return null
    let b = Infinity,
      f = -Infinity
    for (const t of r.tarefas.values()) {
      b = Math.min(b, t.inicio)
      f = Math.max(f, t.fim)
    }
    if (!(b <= f)) return null
    const folga = Math.min(100, Math.max(1, Math.round(((f - b) / DIA) * 0.1)))
    return { b: Math.floor(b / DIA - folga) * DIA, f: Math.ceil(f / DIA + folga) * DIA }
  }, [r])
  // `area` é a própria área do gráfico (sem a legenda e o eixo das unidades)
  const larguraUtil = Math.max(300, area.w - 4)
  const eixo = useMemo(() => {
    if (!spec || !periodo) return null
    const ui = calendarioInterface(spec, false, true)
    const horas = (ui.AS2WS(periodo.f) - ui.AS2WS(periodo.b)) / HORA
    return new EixoTempo(
      ui,
      periodo.b,
      periodo.f,
      pxPorHora ?? (horas > 0 ? larguraUtil / horas : 1)
    )
  }, [spec, periodo, pxPorHora, larguraUtil])

  // ── empilhamento ──
  const nomeadas = useMemo(() => e?.equipesNomeadas ?? [], [e])
  const alturaEquipes = nomeadas.length ? 30 + nomeadas.length * LINHA_EQUIPE : 0
  const alturaGrafico = Math.max(180, area.h - CAB - alturaEquipes - 18)
  const pilha = useMemo(() => {
    const acc = new Acumulado()
    const col = mostrados.map((x) => ({ x, rets: empilhar(x.spans, acc) }))
    return { col, max: Math.max(1, Math.ceil(acc.pico())), acc }
  }, [mostrados])
  const unidade = alturaGrafico / (pilha.max + 1)
  const yDe = (q: number): number => CAB + alturaGrafico - q * unidade
  const limitesMostrados = mostrados
    .filter((x) => x.limite)
    .map((x) => ({ x, y: yDe(x.limite!.maximo) }))

  // ── equipes nomeadas: tarefas e períodos ──
  const cores = useMemo(() => coresServicos(e?.servicos ?? []), [e])
  const ocupacao = useMemo(() => {
    if (!e || !r) return []
    return nomeadas.map((q) => ({
      q,
      barras: e.tarefas
        .filter((t) => t.equipes_ids.includes(q.id) && r.tarefas.has(t.id))
        .flatMap((t) => {
          const res = r.tarefas.get(t.id)!
          return [
            {
              t,
              inicio: res.inicio,
              fim: res.fim,
              cor:
                t.exib?.aparencia?.cor ||
                (t.servico_id ? cores.get(t.servico_id) : undefined) ||
                'var(--text-muted)'
            }
          ]
        })
    }))
  }, [e, r, nomeadas, cores])

  if (!e || !r) return null
  if (!eixo)
    return (
      <div className="flex h-full items-center justify-center text-xs text-text-dim">
        Sem tarefas calculadas.
      </div>
    )

  const W = Math.max(eixo.largura, larguraUtil)
  const x0 = vista - 100,
    x1 = vista + area.w + 100
  const b = eixo.data(Math.max(0, x0)),
    f = eixo.data(Math.min(W, x1))
  const cab = niveisCabecalho(eixo, b, f)
  const naoUteis = global ? periodosNaoUteis(global, eixo, b, f) : []
  const ticks: number[] = []
  {
    let passo = 1
    while ((passo * alturaGrafico) / (pilha.max + 1) < 16) passo *= 2
    for (let n = passo; n <= pilha.max; n += passo) ticks.push(n)
  }
  const tMira = mira ? eixo.data(mira.x) : null
  const valoresMira =
    tMira !== null
      ? mostrados.map((x) => ({ x, q: x.spans.find((s) => s.b <= tMira && tMira < s.e)?.q ?? 0 }))
      : []
  const alturaTotal = CAB + alturaGrafico + 18 + alturaEquipes

  const gravarLimite = (x: RecursoInfo, texto: string): void => {
    const v = lerNumero(texto)
    const atual = e.limites.find((l) => l.recurso_id === x.id && l.grupo_id === null)
    const erro = (er: Error): void => void toast.error(er.message)
    if (v === null || v <= 0) {
      if (atual?.id)
        excluirLimite.mutate({ planejamentoId: e.plano.id, id: atual.id }, { onError: erro })
      return
    }
    salvarLimite.mutate(
      {
        planejamentoId: e.plano.id,
        id: atual?.id ?? null,
        recurso_id: x.id,
        grupo_id: null,
        maximo: v
      },
      { onError: erro }
    )
  }

  return (
    <div className="flex h-full min-h-0">
      {/* legenda */}
      <div
        className="flex shrink-0 flex-col border-r border-border bg-bg-panel"
        style={{ width: LEGENDA }}
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-2xs font-mono uppercase tracking-wider text-text-dim">
            Recursos ({recursos.length})
          </span>
          <div className="flex gap-2 text-2xs">
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => onMostrar(recursos.map((x) => x.id))}
            >
              todos
            </button>
            <button
              type="button"
              className="text-text-dim hover:text-text"
              onClick={() => onMostrar([])}
            >
              nenhum
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {recursos.map((x, k) => {
            const novoGrupo = k === 0 || recursos[k - 1]!.grupo !== x.grupo
            const on = mostrar.has(x.id)
            const estoura = x.limite && x.pico > x.limite.maximo + 1e-9
            return (
              <div key={x.id}>
                {novoGrupo ? (
                  <div className="px-3 pt-2 pb-1 text-2xs font-mono uppercase tracking-wider text-text-dim">
                    {NOME_GRUPO[x.grupo] ?? (x.grupo || 'Outros')}
                  </div>
                ) : null}
                <div
                  className={cn(
                    'group flex items-center gap-2 px-3 py-1 text-xs',
                    on && 'bg-accent-glow/50'
                  )}
                >
                  <input
                    type="checkbox"
                    className="accent-[var(--accent)]"
                    checked={on}
                    onChange={(ev) =>
                      onMostrar(
                        ev.target.checked
                          ? [...mostrar, x.id]
                          : [...mostrar].filter((y) => y !== x.id)
                      )
                    }
                  />
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: x.cor }} />
                  <span className="min-w-0 flex-1 truncate text-text" title={x.nome}>
                    {x.nome}
                  </span>
                  <span
                    className={cn(
                      'w-12 shrink-0 text-right tabular-nums',
                      estoura ? 'text-danger' : 'text-text-muted'
                    )}
                    title="Pico de unidades em uso ao mesmo tempo"
                  >
                    {fmtNum(x.pico, 'auto')}
                  </span>
                  <input
                    key={`${x.id}:${x.limite?.maximo ?? ''}`}
                    defaultValue={x.limite ? fmtNum(x.limite.maximo, 'auto') : ''}
                    placeholder="—"
                    disabled={somenteLeitura}
                    title="Limite: no máximo tantas unidades ao mesmo tempo (o motor nivela as tarefas)"
                    onBlur={(ev) => {
                      const v = ev.target.value.trim()
                      const atual = x.limite ? fmtNum(x.limite.maximo, 'auto') : ''
                      if (v !== atual) gravarLimite(x, v)
                    }}
                    onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()}
                    className="h-5 w-12 shrink-0 rounded-sm border border-transparent bg-transparent px-1 text-right text-xs tabular-nums text-text-muted hover:border-border focus:border-accent focus:bg-bg-elevated focus:outline-none disabled:opacity-60"
                  />
                </div>
              </div>
            )
          })}
        </div>
        <div className="border-t border-border px-3 py-1.5 text-2xs text-text-dim">
          Pico · limite (máx. simultâneo)
        </div>
      </div>

      {/* gráfico */}
      <div className="flex min-w-0 flex-1">
        <svg
          width={EIXO_Y}
          height={alturaTotal}
          className="shrink-0"
          style={{ background: 'var(--bg-panel)' }}
        >
          {ticks.map((n) => (
            <g key={n}>
              <line
                x1={EIXO_Y - 5}
                x2={EIXO_Y}
                y1={yDe(n)}
                y2={yDe(n)}
                stroke="var(--border-strong)"
              />
              <text
                x={EIXO_Y - 7}
                y={yDe(n) + 3.5}
                textAnchor="end"
                className="fill-[var(--text-dim)] font-mono text-[10px]"
              >
                {n}
              </text>
            </g>
          ))}
          <text
            transform={`translate(12 ${CAB + alturaGrafico / 2}) rotate(-90)`}
            textAnchor="middle"
            className="fill-[var(--text-dim)] text-[10px]"
          >
            Unidades em uso
          </text>
          <line
            x1={EIXO_Y - 0.5}
            x2={EIXO_Y - 0.5}
            y1={CAB}
            y2={CAB + alturaGrafico}
            stroke="var(--border-strong)"
          />
        </svg>
        <div
          ref={ref}
          className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
          onScroll={(ev) => setVista((ev.currentTarget as HTMLDivElement).scrollLeft)}
        >
          <svg
            width={W}
            height={alturaTotal}
            className="block"
            onPointerMove={(ev) => {
              const bx = (ev.currentTarget as SVGSVGElement).getBoundingClientRect()
              setMira({ x: ev.clientX - bx.left, cx: ev.clientX, cy: ev.clientY })
            }}
            onPointerLeave={() => setMira(null)}
          >
            {/* cabeçalho do calendário */}
            <rect x={0} y={0} width={W} height={CAB} fill="var(--bg-panel)" />
            {cab.grosso.map((c) => {
              const a = Math.max(c.x0, vista),
                z = Math.min(c.x1, vista + area.w)
              return (
                <g key={`g${c.de}`}>
                  <line
                    x1={c.x0}
                    x2={c.x0}
                    y1={0}
                    y2={cab.temFino ? CAB / 2 : CAB}
                    stroke="var(--border-strong)"
                  />
                  {z - a > c.rotulo.length * 6.2 + 6 ? (
                    <text
                      x={(a + z) / 2}
                      y={cab.temFino ? 15 : 27}
                      textAnchor="middle"
                      className="fill-[var(--text-muted)] text-[11px] font-medium capitalize"
                    >
                      {c.rotulo}
                    </text>
                  ) : null}
                </g>
              )
            })}
            {cab.temFino ? (
              <line x1={0} x2={W} y1={CAB / 2} y2={CAB / 2} stroke="var(--border)" />
            ) : null}
            {cab.fino.map((c) => (
              <g key={`f${c.de}`}>
                <line x1={c.x0} x2={c.x0} y1={CAB / 2} y2={CAB} stroke="var(--border)" />
                {c.x1 - c.x0 > c.rotulo.length * 6.2 + 6 ? (
                  <text
                    x={(c.x0 + c.x1) / 2}
                    y={CAB / 2 + 15}
                    textAnchor="middle"
                    className="fill-[var(--text-dim)] font-mono text-[10px] capitalize"
                  >
                    {c.rotulo}
                  </text>
                ) : null}
              </g>
            ))}
            <line x1={0} x2={W} y1={CAB - 0.5} y2={CAB - 0.5} stroke="var(--border-strong)" />

            {/* fundo do gráfico */}
            {naoUteis.map(([a, z]) => (
              <rect
                key={a}
                x={eixo.x(a)}
                y={CAB}
                width={Math.max(0, eixo.x(z) - eixo.x(a))}
                height={alturaGrafico}
                fill="var(--mt-nao-trab)"
              />
            ))}
            {cab.grosso.map((c) => (
              <line
                key={`v${c.de}`}
                x1={c.x0}
                x2={c.x0}
                y1={CAB}
                y2={alturaTotal}
                stroke="var(--mt-grid-minor)"
              />
            ))}
            {ticks.map((n) => (
              <line
                key={`t${n}`}
                x1={0}
                x2={W}
                y1={yDe(n)}
                y2={yDe(n)}
                stroke="var(--mt-grid-minor)"
                strokeOpacity={0.6}
              />
            ))}

            {/* colunas empilhadas */}
            {pilha.col.map(({ x, rets }) => (
              <g key={x.id}>
                {rets.map((q, k) => (
                  <rect
                    key={k}
                    x={eixo.x(q.t0)}
                    y={yDe(q.topo)}
                    width={Math.max(0.5, eixo.x(q.t1) - eixo.x(q.t0))}
                    height={Math.max(0.5, (q.topo - q.base) * unidade)}
                    fill={x.cor}
                    fillOpacity={0.85}
                  />
                ))}
              </g>
            ))}
            {limitesMostrados.map(({ x, y }) => (
              <g key={`l${x.id}`}>
                <line
                  x1={0}
                  x2={W}
                  y1={y}
                  y2={y}
                  stroke={x.cor}
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                />
                <text x={vista + 6} y={y - 4} className="text-[10px]" fill={x.cor}>
                  limite {x.nome}: {fmtNum(x.limite!.maximo, 'auto')}
                </text>
              </g>
            ))}
            <line
              x1={0}
              x2={W}
              y1={CAB + alturaGrafico + 0.5}
              y2={CAB + alturaGrafico + 0.5}
              stroke="var(--border-strong)"
            />
            {!mostrados.length ? (
              <text
                x={vista + Math.min(area.w, W) / 2}
                y={CAB + alturaGrafico / 2}
                textAnchor="middle"
                className="fill-[var(--text-dim)] text-xs"
              >
                Marque os recursos na legenda para ver o uso no tempo
              </text>
            ) : null}

            {/* ocupação das equipes nomeadas */}
            {nomeadas.length ? (
              <text
                x={vista + 4}
                y={CAB + alturaGrafico + 18 + 14}
                className="fill-[var(--text-dim)] font-mono text-[10px] uppercase tracking-wider"
              >
                Ocupação das equipes nomeadas
              </text>
            ) : null}
            {ocupacao.map(({ q, barras }, k) => {
              const y = CAB + alturaGrafico + 18 + 24 + k * LINHA_EQUIPE
              return (
                <g key={q.id}>
                  <line
                    x1={0}
                    x2={W}
                    y1={y + LINHA_EQUIPE - 0.5}
                    y2={y + LINHA_EQUIPE - 0.5}
                    stroke="var(--mt-grid-minor)"
                    strokeOpacity={0.5}
                  />
                  <text
                    x={vista + 4}
                    y={y + 10}
                    className="fill-[var(--text-muted)] text-[10px] font-medium"
                  >
                    {q.nome}
                  </text>
                  {barras.map((bb) => (
                    <g
                      key={bb.t.id}
                      className="cursor-pointer"
                      onDoubleClick={() => onAbrirTarefa(bb.t.id)}
                      onPointerMove={(ev) =>
                        setDicaEq({
                          x: ev.clientX,
                          y: ev.clientY,
                          conteudo: {
                            titulo: bb.t.nome,
                            linhas: [
                              ['Equipe', q.nome],
                              ['Período', `${fmtDataHora(bb.inicio)} → ${fmtDataHora(bb.fim)}`]
                            ],
                            avisos: []
                          }
                        })
                      }
                      onPointerLeave={() => setDicaEq(null)}
                    >
                      <rect
                        x={eixo.x(bb.inicio)}
                        y={y + 13}
                        width={Math.max(1, eixo.x(bb.fim) - eixo.x(bb.inicio))}
                        height={9}
                        rx={2}
                        fill={bb.cor}
                      />
                    </g>
                  ))}
                </g>
              )
            })}

            {/* mira */}
            {mira ? (
              <line
                x1={mira.x}
                x2={mira.x}
                y1={CAB}
                y2={alturaTotal}
                stroke="var(--mt-cross)"
                strokeDasharray="2 3"
                pointerEvents="none"
              />
            ) : null}
          </svg>
        </div>
      </div>
      {mira && tMira !== null && mostrados.length && !dicaEq ? (
        <DicaFlutuante
          x={mira.cx}
          y={mira.cy}
          conteudo={{
            titulo: fmtDataLonga(tMira),
            linhas: [
              ...valoresMira.map(({ x, q }): [string, string] => [
                x.nome,
                `${fmtNum(q, 'auto')}${x.limite ? ` / ${fmtNum(x.limite.maximo, 'auto')}` : ''}`
              ]),
              [
                'Total',
                fmtNum(
                  valoresMira.reduce((s, v) => s + v.q, 0),
                  'auto'
                )
              ]
            ],
            avisos: valoresMira
              .filter(({ x, q }) => x.limite && q > x.limite.maximo + 1e-9)
              .map(({ x }) => `${x.nome} acima do limite`)
          }}
        />
      ) : null}
      {dicaEq ? <DicaFlutuante x={dicaEq.x} y={dicaEq.y} conteudo={dicaEq.conteudo} /> : null}
    </div>
  )
}

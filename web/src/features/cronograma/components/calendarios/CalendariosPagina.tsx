/**
 * Calendários da obra — os calendários do ApeX (`Calendar`: semana padrão, feriados, Páscoa, folgas anuais e horários
 * excepcionais) com os fatores de produtividade mensais do InfraWork. Cada tarefa usa o calendário do plano ou o seu
 * próprio; a prévia mostra cada dia como o motor o vê.
 *
 * Diagramação (sem rolagem de página): à esquerda o painel de configuração em altura fixa (calendário, semana padrão e,
 * no espaço que sobra, as abas de exceções e fatores); à direita a prévia do ano, dimensionada para caber inteira.
 * Na prévia, clicar ou arrastar sobre os dias abre o editor do dia/período: sem trabalho, outro horário, fator do mês e
 * as exceções que já valem ali.
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  MoreHorizontal,
  Pencil,
  Plus,
  Star,
  Trash2,
  X
} from 'lucide-react'
import { Calendar } from '@apex/calendar'
import { PageHeader } from '@/components/layout/PageHeader'
import { PulseBlock } from '@/components/ui/PulseBlock'
import { TabPill } from '@/components/ui/TabPill'
import { Button } from '@/components/ui/button'
import { ErroConsulta } from '@/components/ui/estado'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Dropdown, DropdownItem, DropdownSeparator } from '@/components/ui/dropdown'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import { contar } from '@/lib/rotulos'
import {
  useCalendariosObra,
  useExcluirCalendario,
  useExcluirDefinicao,
  useExcluirFator,
  useSalvarCalendario,
  useSalvarDefinicoes,
  useSalvarFator,
  type CalendarioRow,
  type DefinicaoInput,
  type DefinicaoRow,
  type FatorRow
} from '../../hooks/calendarios'
import { especificacaoCalendario, feriadosMoveis, jornadaReferencia } from '../../motor/calendario'
import { DIA, isoParaSeg } from '../../motor/tempo'
import type { DiaSemana } from '../../motor/tipos'
import { fmtNum } from '../../visoes/formato'
import { lerNumero } from '../campos-util'
import { Caixa } from '../campos'
import { DefinicaoDialog, type AlvoDefinicao } from './DefinicaoDialog'
import { descricaoDefinicao, NOME_DIA } from './texto'

const PADROES: { nome: string; semana: DiaSemana[] }[] = [
  {
    nome: 'Seg–Sex 8 h',
    semana: [8, 8, 8, 8, 8, 0, 0].map((h) => ({ inicio: '07:00', horas: h }))
  },
  {
    nome: 'Seg–Qui 9 h, Sex 8 h',
    semana: [9, 9, 9, 9, 8, 0, 0].map((h) => ({ inicio: '07:00', horas: h }))
  },
  {
    nome: 'Seg–Qui 8 h, Sex 4 h',
    semana: [8, 8, 8, 8, 4, 0, 0].map((h) => ({ inicio: '07:00', horas: h }))
  },
  {
    nome: 'Seg–Sex 8 h, Sáb 4 h',
    semana: [8, 8, 8, 8, 8, 4, 0].map((h) => ({ inicio: '07:00', horas: h }))
  },
  {
    nome: 'Seg–Sáb 10 h',
    semana: [10, 10, 10, 10, 10, 10, 0].map((h) => ({ inicio: '07:00', horas: h }))
  },
  {
    nome: 'Todos os dias 24 h',
    semana: [24, 24, 24, 24, 24, 24, 24].map((h) => ({ inicio: '00:00', horas: h }))
  }
]

const FERIADOS_NACIONAIS: [string, string][] = [
  ['01-01', 'Confraternização Universal'],
  ['04-21', 'Tiradentes'],
  ['05-01', 'Dia do Trabalho'],
  ['09-07', 'Independência do Brasil'],
  ['10-12', 'Nossa Senhora Aparecida'],
  ['11-02', 'Finados'],
  ['11-15', 'Proclamação da República'],
  ['11-20', 'Dia da Consciência Negra'],
  ['12-25', 'Natal']
]

const NOME_CURTO = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const LETRA_DIA = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D']
const MES_CURTO = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez'
]
const fmtMes = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' })

/** Aviso de gravação que falhou: diz o que não deu certo e repete a mensagem do servidor. */
const falha =
  (oQue: string) =>
  (e: Error): void =>
    void toast.error(`Não foi possível ${oQue}. ${e.message}`)

const semanaDe = (c: CalendarioRow): DiaSemana[] =>
  c.semana.map((d) => ({ inicio: d.inicio, horas: Number(d.horas) }))
const horasSemana = (s: { horas: number | string }[]): number =>
  s.reduce((t, d) => t + (Number(d.horas) || 0), 0)
/** dia da semana 0 = segunda (segundos UTC desde 1970, que foi quinta) */
const diaSemana = (d: number): number => (Math.floor(d / DIA) + 3) % 7
const iso = (d: number): string => new Date(d * 1000).toISOString().slice(0, 10)
const ddmm = (d: number): string => {
  const x = iso(d)
  return `${x.slice(8, 10)}/${x.slice(5, 7)}`
}

export function CalendariosPagina({ obraId }: { obraId: string }): ReactNode {
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const ro = role === 'apoio' || role === 'cliente'
  const q = useCalendariosObra(obraId)
  const [selId, setSelId] = useState<string | null>(null)
  const cals = q.data?.calendarios ?? []
  const fatores = q.data?.fatores ?? []
  const sel = cals.find((c) => c.id === selId) ?? cals.find((c) => c.padrao) ?? cals[0] ?? null
  const salvar = useSalvarCalendario(obraId)
  const erro = falha('criar o calendário')

  const novo = (copiar: CalendarioRow | null): void => {
    const base = copiar ?? cals.find((c) => c.padrao) ?? null
    let nome = copiar ? `${copiar.nome} (cópia)` : 'Novo calendário'
    for (let i = 2; cals.some((c) => c.nome === nome); i++)
      nome = `${copiar ? `${copiar.nome} (cópia` : 'Novo calendário ('}${i})`
    salvar.mutate(
      { id: null, nome, semana: base?.semana ?? PADROES[0]!.semana, copiarDe: copiar?.id ?? null },
      {
        onSuccess: (id) => {
          setSelId(id)
          toast.success(`Calendário "${nome}" criado. Para mudar o nome, use Ações › Renomear.`)
        },
        onError: erro
      }
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Calendários"
        subtitle="Expediente, feriados e fatores de produtividade usados pelo cronograma"
        actions={
          !ro ? (
            <Button size="sm" onClick={() => novo(null)} disabled={salvar.isPending}>
              <CalendarPlus size={12} /> Novo calendário
            </Button>
          ) : null
        }
      />
      {q.isLoading ? (
        <div className="flex min-h-0 flex-1 gap-4 p-4">
          <PulseBlock h={480} className="w-[440px] shrink-0" />
          <PulseBlock h={480} className="flex-1" />
        </div>
      ) : q.error && !q.data ? (
        <ErroConsulta
          className="m-5"
          erro={q.error}
          oQue="os calendários"
          aoTentar={() => void q.refetch()}
        />
      ) : sel ? (
        <EditorCalendario
          key={sel.id}
          obraId={obraId}
          c={sel}
          cals={cals}
          fatores={fatores}
          ro={ro}
          onSelecionar={setSelId}
          onDuplicar={novo}
        />
      ) : (
        <p className="p-5 text-sm text-text-muted">
          Esta obra ainda não tem calendário.
          {ro ? '' : ' Use “Novo calendário” para definir o expediente e os feriados.'}
        </p>
      )}
    </div>
  )
}

/** Seleção do calendário + renomear/padrão/duplicar/remover, numa linha. */
function SeletorCalendario({
  obraId,
  c,
  cals,
  ro,
  onSelecionar,
  onDuplicar
}: {
  obraId: string
  c: CalendarioRow
  cals: CalendarioRow[]
  ro: boolean
  onSelecionar: (id: string) => void
  onDuplicar: (c: CalendarioRow) => void
}): ReactNode {
  const salvar = useSalvarCalendario(obraId)
  const excluir = useExcluirCalendario(obraId)
  const confirmar = useConfirm()
  const [renomeando, setRenomeando] = useState(false)
  const [nome, setNome] = useState(c.nome)
  const erro = falha('salvar o calendário')
  const concluir = (): void => {
    setRenomeando(false)
    if (nome.trim() && nome.trim() !== c.nome)
      salvar.mutate({ id: c.id, nome: nome.trim() }, { onError: erro })
    else setNome(c.nome)
  }
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
      {renomeando ? (
        <Input
          autoFocus
          value={nome}
          aria-label="Nome do calendário"
          onChange={(e) => setNome(e.target.value)}
          onBlur={concluir}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setNome(c.nome)
              setRenomeando(false)
            }
          }}
          className="flex-1"
        />
      ) : (
        <div className="min-w-0 flex-1">
          <Select
            value={c.id}
            onChange={(e) => onSelecionar(e.target.value)}
            aria-label="Calendário"
          >
            {cals.map((x) => (
              <option key={x.id} value={x.id}>
                {x.padrao ? '★ ' : ''}
                {x.nome} · {fmtNum(horasSemana(x.semana), 'auto')} h/sem
              </option>
            ))}
          </Select>
        </div>
      )}
      {c.padrao ? (
        <span
          className="flex shrink-0 items-center gap-1 text-xs text-warn"
          title="Calendário padrão da obra: vale para os planos e tarefas que não escolhem outro"
        >
          <Star size={12} className="fill-[var(--warn)]" /> padrão
        </span>
      ) : null}
      {!ro ? (
        <Dropdown
          align="end"
          trigger={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Ações do calendário"
              title="Ações do calendário"
              aria-haspopup="menu"
            >
              <MoreHorizontal size={14} />
            </Button>
          }
        >
          <DropdownItem onClick={() => setRenomeando(true)}>
            <Pencil size={12} /> Renomear
          </DropdownItem>
          <DropdownItem
            disabled={c.padrao}
            title={c.padrao ? 'Este já é o calendário padrão da obra' : undefined}
            onClick={() => salvar.mutate({ id: c.id, padrao: true }, { onError: erro })}
          >
            <Star size={12} /> Tornar padrão da obra
          </DropdownItem>
          <DropdownItem onClick={() => onDuplicar(c)}>
            <Copy size={12} /> Duplicar
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem
            variant="danger"
            disabled={c.padrao}
            title={
              c.padrao
                ? 'O calendário padrão não pode ser removido: torne outro o padrão antes'
                : undefined
            }
            onClick={async () => {
              const ok = await confirmar({
                title: `Remover o calendário "${c.nome}"?`,
                description: 'Tarefas e planos que o usavam passam a usar o calendário padrão.',
                confirmLabel: 'Remover',
                variant: 'danger'
              })
              if (ok)
                excluir.mutate(c.id, {
                  onSuccess: () => toast.success(`Calendário "${c.nome}" removido.`),
                  onError: falha('remover o calendário')
                })
            }}
          >
            <Trash2 size={12} /> Remover
          </DropdownItem>
        </Dropdown>
      ) : null}
    </div>
  )
}

interface Selecao {
  a: number
  b: number
  rect: DOMRect
}

function EditorCalendario({
  obraId,
  c,
  cals,
  fatores,
  ro,
  onSelecionar,
  onDuplicar
}: {
  obraId: string
  c: CalendarioRow
  cals: CalendarioRow[]
  fatores: FatorRow[]
  ro: boolean
  onSelecionar: (id: string) => void
  onDuplicar: (c: CalendarioRow) => void
}): ReactNode {
  const salvar = useSalvarCalendario(obraId)
  const salvarDefs = useSalvarDefinicoes(obraId)
  const excluirDef = useExcluirDefinicao(obraId)
  const [semana, setSemana] = useState<DiaSemana[]>(semanaDe(c))
  const [def, setDef] = useState<AlvoDefinicao | null>(null)
  const [aba, setAba] = useState<'excecoes' | 'fatores'>('excecoes')
  const [selecao, setSelecao] = useState<Selecao | null>(null)
  const confirmar = useConfirm()
  const erro = falha('salvar o calendário')
  const total = horasSemana(semana)
  const mudouSemana = JSON.stringify(semana) !== JSON.stringify(semanaDe(c))
  // a prévia acompanha a semana em edição (ainda não gravada)
  const cPrevia = useMemo(() => (mudouSemana ? { ...c, semana } : c), [c, semana, mudouSemana])
  const maxHoras = Math.max(8, ...semana.map((d) => d.horas))

  const gravarSemana = (s: DiaSemana[]): void => {
    if (!s.some((d) => d.horas > 0))
      return void toast.error('O calendário precisa de ao menos um dia com horas de trabalho.')
    salvar.mutate({ id: c.id, semana: s }, { onError: erro })
  }
  const mudarDia = (i: number, x: Partial<DiaSemana>): void =>
    setSemana(semana.map((d, j) => (j === i ? { ...d, ...x } : d)))

  const importarNacionais = (): void => {
    const ano = new Date().getFullYear()
    const existentes = new Set(
      c.definicoes
        .filter((d) => d.tipo === 'feriado' && d.todo_ano)
        .map((d) => d.data_inicio?.slice(5))
    )
    const novos: DefinicaoInput[] = FERIADOS_NACIONAIS.filter(([md]) => !existentes.has(md)).map(
      ([md, n], k) => ({
        id: null,
        calendario_id: c.id,
        tipo: 'feriado',
        nome: n,
        data_inicio: `${ano}-${md}`,
        data_fim: `${ano}-${md}`,
        todo_ano: true,
        dia_semana: null,
        semana: null,
        ordem: c.definicoes.length + k
      })
    )
    if (!c.definicoes.some((d) => d.tipo === 'pascoa'))
      novos.push({
        id: null,
        calendario_id: c.id,
        tipo: 'pascoa',
        nome: 'Feriados móveis',
        data_inicio: null,
        data_fim: null,
        todo_ano: false,
        dia_semana: null,
        semana: null,
        ordem: c.definicoes.length + novos.length
      })
    if (!novos.length) return void toast.info('Os feriados nacionais já estão no calendário.')
    salvarDefs.mutate(novos, {
      onSuccess: () =>
        toast.success(`${contar(novos.length, 'feriado incluído', 'feriados incluídos')}.`),
      onError: erro
    })
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* ── configuração (altura fixa; só a lista da aba rola) ─────── */}
      <aside className="flex w-[440px] shrink-0 flex-col overflow-hidden border-r border-border bg-bg-panel">
        <SeletorCalendario
          key={c.id}
          obraId={obraId}
          c={c}
          cals={cals}
          ro={ro}
          onSelecionar={onSelecionar}
          onDuplicar={onDuplicar}
        />

        <section className="shrink-0 border-b border-border">
          <header className="flex h-9 items-center gap-2 px-3">
            <h3 className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
              Semana padrão
            </h3>
            {!ro ? (
              <div className="ml-auto w-44">
                <Select
                  value=""
                  aria-label="Aplicar modelo de semana"
                  onChange={(e) => {
                    const p = PADROES.find((x) => x.nome === e.target.value)
                    if (p) {
                      setSemana(p.semana)
                      gravarSemana(p.semana)
                    }
                  }}
                  className="h-7 text-xs"
                >
                  <option value="">Aplicar modelo…</option>
                  {PADROES.map((p) => (
                    <option key={p.nome}>{p.nome}</option>
                  ))}
                </Select>
              </div>
            ) : null}
          </header>
          <div
            className="grid items-center gap-x-1 gap-y-1 px-3"
            style={{ gridTemplateColumns: '44px repeat(7, minmax(0, 1fr))' }}
          >
            <span />
            {NOME_CURTO.map((n, i) => (
              <span
                key={n}
                className={cn(
                  'text-center text-2xs font-medium',
                  semana[i]!.horas > 0 ? 'text-text' : 'text-text-dim'
                )}
              >
                {n}
              </span>
            ))}
            <span className="text-xs text-text-muted">Início</span>
            {semana.map((d, i) => (
              <Input
                key={i}
                type="time"
                value={d.inicio}
                disabled={ro}
                aria-label={`Início ${NOME_DIA[i]}`}
                onChange={(e) => mudarDia(i, { inicio: e.target.value || '07:00' })}
                className="h-7 px-0 text-center font-mono text-2xs [&::-webkit-calendar-picker-indicator]:hidden"
              />
            ))}
            <span className="text-xs text-text-muted">Horas</span>
            {semana.map((d, i) => (
              <Input
                key={i}
                value={String(d.horas).replace('.', ',')}
                disabled={ro}
                inputMode="decimal"
                aria-label={`Horas ${NOME_DIA[i]}`}
                onChange={(e) => {
                  const v = lerNumero(e.target.value)
                  mudarDia(i, { horas: v === null ? 0 : Math.max(0, Math.min(24, v)) })
                }}
                className="h-7 px-1 text-center font-mono tabular-nums"
              />
            ))}
            <span />
            {semana.map((d, i) => (
              <span key={i} className="h-1 rounded-full bg-bg" aria-hidden>
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${(d.horas / maxHoras) * 100}%`,
                    background: 'color-mix(in oklch, var(--accent) 70%, transparent)'
                  }}
                />
              </span>
            ))}
          </div>
          <div className="flex h-10 items-center gap-2 px-3">
            <span className="text-xs tabular text-text-muted">
              {fmtNum(total, 'auto')} h/semana · dia cheio{' '}
              {fmtNum(jornadaReferencia({ semana }), 'auto')} h
            </span>
            {mudouSemana && !ro ? (
              <div className="ml-auto flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setSemana(semanaDe(c))}>
                  Descartar
                </Button>
                <Button size="sm" onClick={() => gravarSemana(semana)} disabled={salvar.isPending}>
                  {salvar.isPending ? 'Salvando…' : 'Salvar semana'}
                </Button>
              </div>
            ) : null}
          </div>
        </section>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-center gap-4 border-b border-border px-3">
            <div role="tablist" aria-label="Exceções e fatores" className="flex h-full gap-4">
              <TabPill
                active={aba === 'excecoes'}
                onClick={() => setAba('excecoes')}
                className="h-9 py-0 text-sm"
              >
                Exceções <span className="tabular-nums">{c.definicoes.length}</span>
              </TabPill>
              <TabPill
                active={aba === 'fatores'}
                onClick={() => setAba('fatores')}
                className="h-9 py-0 text-sm"
              >
                Fatores mensais <span className="tabular-nums">{fatores.length}</span>
              </TabPill>
            </div>
            {aba === 'excecoes' && !ro ? (
              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={importarNacionais}
                  disabled={salvarDefs.isPending}
                  title="Feriados nacionais fixos e móveis"
                >
                  <Download size={12} /> Nacionais
                </Button>
                <Dropdown
                  align="end"
                  trigger={
                    <Button variant="secondary" size="sm">
                      <Plus size={12} /> Incluir
                    </Button>
                  }
                >
                  <DropdownItem onClick={() => setDef({ calendario: c, tipo: 'feriado' })}>
                    Feriado ou período sem trabalho
                  </DropdownItem>
                  <DropdownItem
                    disabled={c.definicoes.some((d) => d.tipo === 'pascoa')}
                    onClick={() => setDef({ calendario: c, tipo: 'pascoa' })}
                  >
                    Feriados móveis (Carnaval, Sexta-feira Santa, Corpus Christi)
                  </DropdownItem>
                  <DropdownItem onClick={() => setDef({ calendario: c, tipo: 'folga_semana' })}>
                    Folga anual num dia da semana
                  </DropdownItem>
                  <DropdownItem onClick={() => setDef({ calendario: c, tipo: 'horario_excecao' })}>
                    Horário excepcional (outra semana num período)
                  </DropdownItem>
                </Dropdown>
              </div>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {aba === 'excecoes' ? (
              c.definicoes.length ? (
                <ul className="py-1">
                  {c.definicoes.map((d) => (
                    <LinhaDefinicao
                      key={d.id}
                      d={d}
                      ro={ro}
                      onEditar={() => setDef({ calendario: c, tipo: d.tipo, def: d })}
                      onRemover={async () => {
                        const ok = await confirmar({
                          title: `Remover "${d.nome || ROTULO_TIPO[d.tipo]}" do calendário?`,
                          description:
                            'Os dias voltam a seguir a semana padrão e o cronograma é recalculado.',
                          confirmLabel: 'Remover',
                          variant: 'danger'
                        })
                        if (ok) excluirDef.mutate(d.id, { onError: falha('remover a exceção') })
                      }}
                    />
                  ))}
                </ul>
              ) : (
                <p className="px-3 py-3 text-xs text-text-muted">
                  Nenhum feriado ou exceção. Use “Nacionais” ou clique nos dias da prévia.
                </p>
              )
            ) : (
              <Fatores obraId={obraId} fatores={fatores} ro={ro} />
            )}
          </div>
        </div>
      </aside>

      {/* ── prévia ─────────────────────────────────────────────────── */}
      <PreviaAno
        c={cPrevia}
        fatores={fatores}
        rascunho={mudouSemana}
        selecao={selecao}
        onSelecionar={ro ? undefined : setSelecao}
      />
      {selecao && !ro ? (
        <EditorDias
          key={`${selecao.a}-${selecao.b}`}
          obraId={obraId}
          c={c}
          fatores={fatores}
          sel={selecao}
          onFechar={() => setSelecao(null)}
          onEditarDef={(d) => {
            setSelecao(null)
            setDef({ calendario: c, tipo: d.tipo, def: d })
          }}
        />
      ) : null}
      <DefinicaoDialog obraId={obraId} alvo={def} onFechar={() => setDef(null)} />
    </div>
  )
}

const ROTULO_TIPO: Record<DefinicaoRow['tipo'], string> = {
  feriado: 'Feriado',
  pascoa: 'Móveis',
  folga_semana: 'Folga',
  horario_excecao: 'Horário'
}

function LinhaDefinicao({
  d,
  ro,
  onEditar,
  onRemover
}: {
  d: DefinicaoRow
  ro: boolean
  onEditar: () => void
  onRemover: () => void | Promise<void>
}): ReactNode {
  const desc = descricaoDefinicao(d)
  return (
    <li className="group flex h-8 items-center gap-2 px-3 hover:bg-bg-hover/40">
      <span className="w-[52px] shrink-0 text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
        {ROTULO_TIPO[d.tipo]}
      </span>
      <span className="max-w-[45%] shrink-0 truncate text-xs text-text" title={d.nome}>
        {d.nome || ROTULO_TIPO[d.tipo]}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-text-muted" title={desc}>
        {desc}
      </span>
      {!ro ? (
        <span className="flex shrink-0 gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onEditar}
            aria-label={`Editar ${d.nome || ROTULO_TIPO[d.tipo]}`}
            title="Editar"
          >
            <Pencil size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => void onRemover()}
            aria-label={`Remover ${d.nome || ROTULO_TIPO[d.tipo]}`}
            title="Remover"
          >
            <Trash2 size={12} />
          </Button>
        </span>
      ) : null}
    </li>
  )
}

/** Tamanho de um elemento (ResizeObserver). */
function useTamanho<T extends HTMLElement>(): [RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null)
  const [t, setT] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      if (e) setT({ w: e.contentRect.width, h: e.contentRect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, t]
}

const GAP_X = 16
const GAP_Y = 14
const CAB_MES = 38 // nome do mês + letras dos dias
const MAX_CELULA = 40
const MIN_CELULA = 16 // abaixo disto o número do dia (11 px) não cabe: a prévia passa a rolar
const CELULA_ROLANDO = 20

/**
 * Colunas de meses (2, 3, 4, 6) que dão a maior célula sem rolagem na área disponível. Em área estreita, quando
 * nem assim o dia fica legível, usa o máximo de colunas com célula de 20 px e a prévia rola na vertical.
 */
function grade(w: number, h: number): { cols: number; cel: number } {
  let melhor = { cols: 4, cel: 0 }
  for (const cols of [2, 3, 4, 6]) {
    const linhas = 12 / cols
    const porLargura = (w - (cols - 1) * GAP_X) / cols / 7
    const porAltura = (h - linhas * CAB_MES - (linhas - 1) * GAP_Y) / linhas / 6
    const cel = Math.floor(Math.min(porLargura, porAltura, MAX_CELULA))
    if (cel > melhor.cel) melhor = { cols, cel }
  }
  if (melhor.cel >= MIN_CELULA) return melhor
  for (const cols of [4, 3, 2]) {
    const cel = Math.floor((w - (cols - 1) * GAP_X) / cols / 7)
    if (cel >= CELULA_ROLANDO) return { cols, cel: Math.min(cel, 28) }
  }
  return { cols: 1, cel: Math.max(MIN_CELULA, Math.min(Math.floor(w / 7), 28)) }
}

/** Horas de trabalho do dia (segundos UTC do início do dia) pelo calendário do motor. */
const horasDoDia = (cal: Calendar, d: number): number => (cal.AS2WS(d + DIA) - cal.AS2WS(d)) / 3600

function useCalendarioMotor(c: CalendarioRow, fatores: FatorRow[]): Calendar | null {
  return useMemo(() => {
    try {
      return new Calendar(especificacaoCalendario(c, fatores))
    } catch {
      return null
    }
  }, [c, fatores])
}

/** Prévia de um ano: as horas de cada dia pelo calendário como o motor o monta; clique/arraste seleciona dias. */
function PreviaAno({
  c,
  fatores,
  rascunho,
  selecao,
  onSelecionar
}: {
  c: CalendarioRow
  fatores: FatorRow[]
  rascunho: boolean
  selecao: Selecao | null
  onSelecionar?: (s: Selecao) => void
}): ReactNode {
  const [ano, setAno] = useState(new Date().getFullYear())
  const [ref, tam] = useTamanho<HTMLDivElement>()
  const cal = useCalendarioMotor(c, fatores)
  const jornada = jornadaReferencia(c) || 8
  const motivos = useMemo(() => motivosDoAno(c, fatores, ano), [c, fatores, ano])
  const hoje = isoParaSeg(new Date().toISOString().slice(0, 10))
  const [arrasto, setArrasto] = useState<{ a: number; b: number } | null>(null)
  const ultimo = useRef<HTMLElement | null>(null)

  // soltar o botão (sobre um dia ou fora) conclui a seleção
  useEffect(() => {
    if (!arrasto || !onSelecionar) return
    const solta = (): void => {
      const a = Math.min(arrasto.a, arrasto.b)
      const b = Math.max(arrasto.a, arrasto.b)
      const rect = ultimo.current?.getBoundingClientRect()
      setArrasto(null)
      if (rect) onSelecionar({ a, b, rect })
    }
    window.addEventListener('mouseup', solta)
    return () => window.removeEventListener('mouseup', solta)
  }, [arrasto, onSelecionar])

  const meses = useMemo(() => {
    if (!cal) return []
    return Array.from({ length: 12 }, (_, m) => {
      const ini = Date.UTC(ano, m, 1) / 1000
      const n = new Date(Date.UTC(ano, m + 1, 0)).getUTCDate()
      const dias = Array.from({ length: n }, (_, i) => {
        const d = ini + i * DIA
        return { d, n: i + 1, h: horasDoDia(cal, d) }
      })
      return {
        m,
        nome: fmtMes.format(new Date(ini * 1000)),
        pula: (new Date(ini * 1000).getUTCDay() + 6) % 7,
        dias,
        horas: dias.reduce((s, x) => s + x.h, 0),
        uteis: dias.filter((x) => x.h > 0).length
      }
    })
  }, [cal, ano])
  const totalAno = meses.reduce((s, x) => s + x.horas, 0)
  const uteisAno = meses.reduce((s, x) => s + x.uteis, 0)
  const { cols, cel } = grade(tam.w, tam.h)
  const fonte = Math.max(11, Math.min(13, Math.round(cel * 0.4)))
  const marcado = arrasto
    ? { a: Math.min(arrasto.a, arrasto.b), b: Math.max(arrasto.a, arrasto.b) }
    : selecao

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
        <h3 className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">Prévia</h3>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setAno(ano - 1)}
            aria-label="Ano anterior"
            title="Ano anterior"
          >
            <ChevronLeft size={14} />
          </Button>
          <span className="w-12 text-center font-mono text-sm font-semibold tabular-nums text-text">
            {ano}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setAno(ano + 1)}
            aria-label="Próximo ano"
            title="Próximo ano"
          >
            <ChevronRight size={14} />
          </Button>
        </div>
        <span
          className="min-w-0 truncate text-xs tabular text-text-muted"
          title={`${fmtNum(totalAno, 0)} h · ${uteisAno} dias com trabalho`}
        >
          {fmtNum(totalAno, 0)} h · {uteisAno} dias com trabalho
        </span>
        {rascunho ? (
          <span
            className="shrink-0 rounded-sm px-1.5 py-0.5 text-xs text-warn"
            style={{ background: 'color-mix(in oklch, var(--warn) 12%, transparent)' }}
          >
            semana não salva
          </span>
        ) : null}
        {onSelecionar ? (
          <span className="ml-auto hidden min-w-0 truncate text-xs text-text-muted xl:inline">
            Clique ou arraste nos dias para editar
          </span>
        ) : null}
      </header>
      <div
        ref={ref}
        role="region"
        aria-label={`Prévia de ${ano}`}
        tabIndex={onSelecionar ? undefined : 0}
        className="min-h-0 flex-1 overflow-auto px-3 py-4"
      >
        {!cal ? (
          <p className="text-sm text-danger">
            Este calendário não tem horas de trabalho: informe as horas de ao menos um dia na
            semana padrão.
          </p>
        ) : tam.w > 0 ? (
          <div
            className="grid select-none justify-center"
            style={{
              gridTemplateColumns: `repeat(${cols}, ${cel * 7}px)`,
              columnGap: GAP_X,
              rowGap: GAP_Y,
              fontSize: fonte
            }}
          >
            {meses.map((mes) => (
              <div key={mes.m}>
                <div className="flex h-[22px] items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-xs font-medium capitalize text-text">
                    {mes.nome}
                  </span>
                  <span className="shrink-0 whitespace-nowrap font-mono text-2xs tabular-nums text-text-dim">
                    {fmtNum(mes.horas, 0)}h · {mes.uteis}d
                  </span>
                </div>
                <div
                  className="grid text-center"
                  style={{
                    gridTemplateColumns: `repeat(7, ${cel}px)`,
                    gridTemplateRows: '16px',
                    gridAutoRows: cel
                  }}
                >
                  {LETRA_DIA.map((l, i) => (
                    <span key={i} className="font-mono text-2xs leading-4 text-text-dim">
                      {l}
                    </span>
                  ))}
                  {Array.from({ length: mes.pula }, (_, i) => (
                    <span key={`v${i}`} />
                  ))}
                  {mes.dias.map(({ d, n, h }) => {
                    const motivo = motivos.get(d)?.textos.join('; ')
                    const frac = Math.min(1, h / jornada)
                    // vermelho só quando se perde um dia que a semana padrão trabalharia (feriado, folga)
                    const perdido = h === 0 && !!motivo && Number(c.semana[diaSemana(d)]?.horas) > 0
                    const naSelecao = !!marcado && d >= marcado.a && d <= marcado.b
                    const rotulo = `${String(n).padStart(2, '0')}/${String(mes.m + 1).padStart(2, '0')}: ${fmtNum(h, 'auto')} h${motivo ? `; ${motivo}` : ''}`
                    return (
                      <span key={n}>
                        <button
                          type="button"
                          title={rotulo}
                          aria-label={rotulo}
                          tabIndex={onSelecionar ? 0 : -1}
                          disabled={!onSelecionar}
                          onMouseDown={(e) => {
                            if (e.button !== 0 || !onSelecionar) return
                            ultimo.current = e.currentTarget
                            setArrasto({ a: d, b: d })
                          }}
                          onMouseEnter={(e) => {
                            if (!arrasto) return
                            ultimo.current = e.currentTarget
                            setArrasto({ ...arrasto, b: d })
                          }}
                          onKeyDown={(e) => {
                            if ((e.key === 'Enter' || e.key === ' ') && onSelecionar) {
                              e.preventDefault()
                              onSelecionar({
                                a: d,
                                b: d,
                                rect: e.currentTarget.getBoundingClientRect()
                              })
                            }
                          }}
                          className={cn(
                            'grid h-full w-full place-items-center rounded-[3px] border border-transparent bg-clip-padding tabular-nums outline-none',
                            onSelecionar &&
                              'cursor-pointer hover:ring-1 hover:ring-inset hover:ring-text-muted',
                            'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                            perdido ? 'text-danger' : h === 0 ? 'text-text-dim' : 'text-text',
                            d === hoje && 'ring-1 ring-inset ring-text',
                            naSelecao && 'ring-2 ring-inset ring-accent-hover'
                          )}
                          style={{
                            backgroundColor:
                              h > 0
                                ? `color-mix(in oklch, var(--accent) ${Math.round(14 + 26 * frac)}%, transparent)`
                                : perdido
                                  ? 'color-mix(in oklch, var(--danger) 18%, transparent)'
                                  : undefined
                          }}
                        >
                          {n}
                        </button>
                      </span>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <Legenda />
    </section>
  )
}

function Legenda(): ReactNode {
  const item = (cor: string | undefined, txt: string, borda = false): ReactNode => (
    <span className="flex items-center gap-1.5">
      <span
        className={cn('h-2.5 w-2.5 rounded-[2px]', borda && 'border border-border-strong')}
        style={{ background: cor }}
      />
      {txt}
    </span>
  )
  return (
    <footer className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 whitespace-nowrap border-t border-border px-4 py-1.5 text-xs text-text-muted">
      {item('color-mix(in oklch, var(--accent) 40%, transparent)', 'dia cheio')}
      {item('color-mix(in oklch, var(--accent) 22%, transparent)', 'jornada reduzida')}
      {item('color-mix(in oklch, var(--danger) 18%, transparent)', 'dia de trabalho perdido')}
      {item(undefined, 'sem trabalho', true)}
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[2px] ring-1 ring-inset ring-text" />
        hoje
      </span>
    </footer>
  )
}

interface MotivoDia {
  textos: string[]
  defs: DefinicaoRow[]
}

/** O que muda cada dia do ano: textos (dica da prévia) e as definições que valem no dia (editor). */
function motivosDoAno(c: CalendarioRow, fatores: FatorRow[], ano: number): Map<number, MotivoDia> {
  const m = new Map<number, MotivoDia>()
  const marca = (de: string, ate: string, txt: string, def?: DefinicaoRow): void => {
    for (let d = isoParaSeg(de); d <= isoParaSeg(ate); d += DIA) {
      const x = m.get(d) ?? { textos: [], defs: [] }
      x.textos.push(txt)
      if (def && !x.defs.includes(def)) x.defs.push(def)
      m.set(d, x)
    }
  }
  for (const f of fatores) {
    if (!f.ano_mes.startsWith(String(ano))) continue
    const ini = f.ano_mes.slice(0, 10)
    const fim = new Date(Date.UTC(ano, Number(f.ano_mes.slice(5, 7)), 0)).toISOString().slice(0, 10)
    marca(ini, fim, `fator ${fmtNum(f.fator, 'auto')}`)
  }
  for (const d of c.definicoes) {
    if (d.tipo === 'feriado' && d.data_inicio && d.data_fim) {
      if (d.todo_ano)
        marca(`${ano}${d.data_inicio.slice(4)}`, `${ano}${d.data_fim.slice(4)}`, d.nome, d)
      else marca(d.data_inicio, d.data_fim, d.nome, d)
    } else if (d.tipo === 'pascoa') {
      for (const [n, de, ate] of feriadosMoveis(ano)) marca(de, ate, n, d)
    } else if (d.tipo === 'horario_excecao' && d.data_inicio && d.data_fim) {
      marca(d.data_inicio, d.data_fim, d.nome || 'horário excepcional', d)
    } else if (d.tipo === 'folga_semana' && d.data_inicio && d.dia_semana !== null) {
      let x = isoParaSeg(`${ano}${d.data_inicio.slice(4)}`)
      for (let k = 0; k < 7 && diaSemana(x) !== d.dia_semana; k++) x += DIA
      marca(iso(x), iso(x), d.nome || 'folga', d)
    }
  }
  return m
}

/** Painel flutuante ancorado num retângulo da tela (fecha com Esc ou clique fora). */
function Flutuante({
  rect,
  onFechar,
  children
}: {
  rect: DOMRect
  onFechar: () => void
  children: ReactNode
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  // o foco entra no painel ao abrir e volta ao dia de onde saiu ao fechar
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true })
    return () => {
      if (anterior && document.contains(anterior)) anterior.focus({ preventScroll: true })
    }
  }, [])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left = rect.right + 8
    if (left + w > window.innerWidth - 8) left = rect.left - w - 8
    left = Math.max(8, left)
    const top = Math.max(8, Math.min(rect.top - 12, window.innerHeight - h - 8))
    setPos({ top, left })
  }, [rect])
  useEffect(() => {
    const fora = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onFechar()
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onFechar()
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', esc)
    }
  }, [onFechar])
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Editar dias do calendário"
      className="fixed z-50 w-[320px] rounded border border-border-strong bg-[color:var(--popover)] shadow-[var(--sombra-flutuante)]"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
    >
      {children}
    </div>,
    document.body
  )
}

/** Editor do dia ou período selecionado na prévia. */
function EditorDias({
  obraId,
  c,
  fatores,
  sel,
  onFechar,
  onEditarDef
}: {
  obraId: string
  c: CalendarioRow
  fatores: FatorRow[]
  sel: Selecao
  onFechar: () => void
  onEditarDef: (d: DefinicaoRow) => void
}): ReactNode {
  const salvarDefs = useSalvarDefinicoes(obraId)
  const excluirDef = useExcluirDefinicao(obraId)
  const salvarFator = useSalvarFator(obraId)
  const excluirFator = useExcluirFator(obraId)
  const cal = useCalendarioMotor(c, fatores)
  const { a, b } = sel
  const nDias = Math.round((b - a) / DIA) + 1
  const anoA = new Date(a * 1000).getUTCFullYear()
  const mesmoMes = iso(a).slice(0, 7) === iso(b).slice(0, 7)
  const anoMes = `${iso(a).slice(0, 7)}-01`
  const fatorMes = fatores.find((f) => f.ano_mes.slice(0, 10) === anoMes)

  // horas atuais e definições que já valem nos dias selecionados
  const { horas, defs } = useMemo(() => {
    let h = 0
    const ds: DefinicaoRow[] = []
    const porAno = new Map<number, Map<number, MotivoDia>>()
    for (let d = a; d <= b; d += DIA) {
      if (cal) h += horasDoDia(cal, d)
      const y = new Date(d * 1000).getUTCFullYear()
      if (!porAno.has(y)) porAno.set(y, motivosDoAno(c, fatores, y))
      for (const x of porAno.get(y)!.get(d)?.defs ?? []) if (!ds.includes(x)) ds.push(x)
    }
    return { horas: h, defs: ds }
  }, [a, b, c, fatores, cal])

  const padrao = c.semana[diaSemana(a)]
  const [nome, setNome] = useState('')
  const [todoAno, setTodoAno] = useState(false)
  const [inicio, setInicio] = useState(padrao?.inicio ?? '07:00')
  const [horasDia, setHorasDia] = useState(String(Number(padrao?.horas) || 8).replace('.', ','))
  const [fator, setFator] = useState(fatorMes ? String(fatorMes.fator).replace('.', ',') : '1')
  const erro = falha('salvar a alteração do calendário')
  const ocupado = salvarDefs.isPending || salvarFator.isPending

  const nova = (x: Pick<DefinicaoInput, 'tipo' | 'nome' | 'todo_ano' | 'semana'>): void =>
    salvarDefs.mutate(
      [
        {
          id: null,
          calendario_id: c.id,
          data_inicio: iso(a),
          data_fim: iso(b),
          dia_semana: null,
          ordem: c.definicoes.length,
          ...x
        }
      ],
      { onSuccess: onFechar, onError: erro }
    )

  const titulo =
    nDias === 1
      ? `${NOME_DIA[diaSemana(a)]}, ${ddmm(a)}/${anoA}`
      : `${ddmm(a)} a ${ddmm(b)}/${new Date(b * 1000).getUTCFullYear()}`

  return (
    <Flutuante rect={sel.rect} onFechar={onFechar}>
      <header className="flex items-start gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text">{titulo}</div>
          <div className="text-xs tabular text-text-muted">
            {nDias > 1 ? `${nDias} dias · ` : ''}
            {fmtNum(horas, 'auto')} h de trabalho
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onFechar}
          aria-label="Fechar"
        >
          <X size={13} />
        </Button>
      </header>

      {defs.length ? (
        <ul className="border-b border-border py-1">
          {defs.map((d) => (
            <li key={d.id} className="group flex h-8 items-center gap-2 px-3">
              <span className="w-[52px] shrink-0 text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
                {ROTULO_TIPO[d.tipo]}
              </span>
              <span
                className="min-w-0 flex-1 truncate text-xs text-text"
                title={descricaoDefinicao(d)}
              >
                {d.nome || ROTULO_TIPO[d.tipo]}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onEditarDef(d)}
                aria-label={`Editar ${d.nome || ROTULO_TIPO[d.tipo]}`}
                title="Editar"
              >
                <Pencil size={12} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() =>
                  excluirDef.mutate(d.id, {
                    onSuccess: () => {
                      toast.success(`"${d.nome || ROTULO_TIPO[d.tipo]}" removido do calendário.`)
                      onFechar()
                    },
                    onError: falha('remover a exceção')
                  })
                }
                aria-label={`Remover ${d.nome || ROTULO_TIPO[d.tipo]}`}
                title="Remover"
              >
                <Trash2 size={12} />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-2 border-b border-border px-3 py-2.5">
        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Descrição (feriado municipal, paralisação, férias coletivas…)"
          aria-label="Descrição"
        />
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={ocupado}
            onClick={() =>
              nova({
                tipo: 'feriado',
                nome: nome.trim() || (nDias === 1 ? 'Sem trabalho' : 'Período sem trabalho'),
                todo_ano: todoAno,
                semana: null
              })
            }
          >
            Sem trabalho
          </Button>
          <Caixa marcado={todoAno} onMudar={setTodoAno}>
            Repetir todo ano
          </Caixa>
        </div>
        <div className="flex items-center gap-1.5">
          <Input
            type="time"
            value={inicio}
            onChange={(e) => setInicio(e.target.value || '07:00')}
            aria-label="Início"
            className="h-7 w-[64px] px-1 text-center text-xs tabular [&::-webkit-calendar-picker-indicator]:hidden"
          />
          <Input
            value={horasDia}
            onChange={(e) => setHorasDia(e.target.value)}
            inputMode="decimal"
            aria-label="Horas por dia"
            className="h-7 w-12 px-1 text-right tabular"
          />
          <span className="text-xs text-text-muted">h/dia</span>
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            disabled={ocupado}
            onClick={() => {
              const v = lerNumero(horasDia)
              if (v === null || v <= 0 || v > 24)
                return void toast.error('As horas vão de 0,5 a 24.')
              nova({
                tipo: 'horario_excecao',
                nome: nome.trim() || 'Horário especial',
                todo_ano: false,
                semana: Array.from({ length: 7 }, () => ({ inicio, horas: v }))
              })
            }}
          >
            Trabalhar neste horário
          </Button>
        </div>
      </div>

      {mesmoMes ? (
        <div className="flex items-center gap-1.5 px-3 py-2.5">
          <span className="flex-1 text-xs text-text">
            Fator de {MES_CURTO[Number(anoMes.slice(5, 7)) - 1]}/{anoMes.slice(0, 4)}
          </span>
          <Input
            value={fator}
            onChange={(e) => setFator(e.target.value)}
            inputMode="decimal"
            aria-label="Fator do mês"
            className="h-7 w-14 px-1 text-right tabular"
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={ocupado}
            onClick={() => {
              const v = lerNumero(fator)
              if (v === null || v <= 0 || v > 2) return void toast.error('O fator vai de 0,01 a 2.')
              if (v === 1 && fatorMes)
                return void excluirFator.mutate(anoMes, { onSuccess: onFechar, onError: erro })
              salvarFator.mutate(
                { ano_mes: anoMes, fator: v, motivo: fatorMes?.motivo ?? (nome.trim() || null) },
                { onSuccess: onFechar, onError: erro }
              )
            }}
          >
            Aplicar
          </Button>
        </div>
      ) : null}
    </Flutuante>
  )
}

function Fatores({
  obraId,
  fatores,
  ro
}: {
  obraId: string
  fatores: FatorRow[]
  ro: boolean
}): ReactNode {
  const salvar = useSalvarFator(obraId)
  const excluir = useExcluirFator(obraId)
  const [mes, setMes] = useState('')
  const [fator, setFator] = useState('0,8')
  const [motivo, setMotivo] = useState('')
  const confirmar = useConfirm()
  const erro = falha('salvar o fator do mês')
  const incluir = (): void => {
    const v = lerNumero(fator)
    if (v === null || v <= 0 || v > 2) return void toast.error('O fator vai de 0,01 a 2.')
    salvar.mutate(
      { ano_mes: `${mes}-01`, fator: v, motivo: motivo.trim() || null },
      { onSuccess: () => (setMes(''), setMotivo('')), onError: erro }
    )
  }
  return (
    <div>
      <p className="px-3 pt-2 text-xs text-text-muted">
        Fração das horas trabalhadas no mês, em todos os calendários: 1 = normal; 0,6 = 60% (chuvas,
        por exemplo).
      </p>
      {!ro ? (
        <div className="flex items-center gap-1.5 px-3 py-2">
          <Input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            aria-label="Mês"
            className="h-7 w-[132px] px-1.5 font-mono"
          />
          <Input
            value={fator}
            onChange={(e) => setFator(e.target.value)}
            inputMode="decimal"
            aria-label="Fator"
            className="h-7 w-14 text-right font-mono tabular-nums"
          />
          <Input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && mes && incluir()}
            placeholder="Motivo (opcional)"
            aria-label="Motivo"
            className="h-7 min-w-0 flex-1"
          />
          <Button
            size="icon"
            variant="secondary"
            disabled={!mes || salvar.isPending}
            onClick={incluir}
            aria-label="Incluir fator"
            title={mes ? 'Incluir fator' : 'Escolha o mês para incluir o fator'}
          >
            <Plus size={13} />
          </Button>
        </div>
      ) : null}
      {fatores.length ? (
        <ul className="border-t border-border py-1">
          {fatores.map((f) => (
            <li
              key={f.ano_mes}
              className="group flex h-8 items-center gap-2 px-3 text-xs hover:bg-bg-hover/40"
            >
              <span className="w-[72px] shrink-0 font-mono text-text">
                {MES_CURTO[Number(f.ano_mes.slice(5, 7)) - 1]}/{f.ano_mes.slice(0, 4)}
              </span>
              <span className="w-10 shrink-0 text-right font-mono tabular-nums text-text">
                {fmtNum(f.fator, 'auto')}
              </span>
              <span className="min-w-0 flex-1 truncate text-text-muted">{f.motivo ?? ''}</span>
              {!ro ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                  onClick={async () => {
                    const rotulo = `${MES_CURTO[Number(f.ano_mes.slice(5, 7)) - 1]}/${f.ano_mes.slice(0, 4)}`
                    const ok = await confirmar({
                      title: `Remover o fator de ${rotulo}?`,
                      description:
                        'O mês volta à produtividade normal em todos os calendários e o cronograma é recalculado.',
                      confirmLabel: 'Remover',
                      variant: 'danger'
                    })
                    if (ok)
                      excluir.mutate(f.ano_mes.slice(0, 10), {
                        onError: falha('remover o fator do mês')
                      })
                  }}
                  aria-label={`Remover o fator de ${MES_CURTO[Number(f.ano_mes.slice(5, 7)) - 1]}/${f.ano_mes.slice(0, 4)}`}
                  title="Remover o fator"
                >
                  <Trash2 size={12} />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 pb-3 text-xs text-text-muted">
          Sem fatores: produtividade normal em todos os meses.
        </p>
      )}
    </div>
  )
}

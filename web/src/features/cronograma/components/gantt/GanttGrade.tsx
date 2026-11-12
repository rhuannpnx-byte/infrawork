/**
 * Grade à esquerda do Gantt (a `DGrid` da `GanttView` do ApeX, com as colunas da planilha de tarefas): hierarquia
 * numerada, recolher/expandir, seleção sincronizada com as barras e edição em célula (nome, prioridade, equipes).
 * Rola junto com a linha do tempo (a rolagem vertical é dela).
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type WheelEvent
} from 'react'
import { ChevronDown, ChevronRight, FolderTree, LayoutList, MapPin, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ColunaGantt } from '../../store'
import type { LinhaGantt } from '../../visoes/gantt-dados'
import { ALTURA_CABECALHO, ALTURA_LINHA } from './GanttLinhaTempo'

export interface DefColuna {
  id: ColunaGantt
  titulo: string
  largura: number
  direita?: boolean
  texto: (l: LinhaGantt) => string
  /** edição em célula (só tarefas, plano em edição) */
  editar?: {
    tipo: 'texto' | 'inteiro' | 'opcoes'
    valor: (l: LinhaGantt) => string
    gravar: (l: LinhaGantt, v: string) => void
    /** `opcoes`: a lista (o combo Location do ApeX) */
    opcoes?: (l: LinhaGantt) => { valor: string; rotulo: string }[]
  }
  dica?: string
}

interface Props {
  linhas: LinhaGantt[]
  colunas: DefColuna[]
  largura: number
  scrollTop: number
  alturaVista: number
  comFilhas: ReadonlySet<string>
  recolhidas: ReadonlySet<string>
  selecionadas: ReadonlySet<string>
  cores: (l: LinhaGantt) => string
  somenteLeitura: boolean
  onRolar: (deltaY: number) => void
  /** a grade rolou sozinha (foco, busca do navegador): a linha do tempo acompanha */
  onRolarPara: (top: number) => void
  onAlternar: (l: LinhaGantt) => void
  onSelecionar: (l: LinhaGantt, e: { ctrl: boolean; shift: boolean }) => void
  onAbrir: (l: LinhaGantt) => void
  onMenu: (l: LinhaGantt | null, x: number, y: number) => void
}

const RECUO = 14

export function GanttGrade(p: Props): ReactNode {
  const corpo = useRef<HTMLDivElement>(null)
  const [editando, setEditando] = useState<{
    chave: string
    col: ColunaGantt
    valor: string
  } | null>(null)

  // a grade segue a linha do tempo antes de pintar; `aplicado` guarda a posição posta por código, para que o evento
  // de rolagem que ela gera (que pode chegar depois de um render mais novo) não volte como pedido de rolagem
  const aplicado = useRef(0)
  useLayoutEffect(() => {
    const el = corpo.current
    if (!el) return
    el.scrollTop = p.scrollTop
    aplicado.current = el.scrollTop
  }, [p.scrollTop])

  const total = p.colunas.reduce((s, c) => s + c.largura, 0)
  const i0 = Math.max(0, Math.floor(p.scrollTop / ALTURA_LINHA) - 4)
  const i1 = Math.min(
    p.linhas.length - 1,
    Math.ceil((p.scrollTop + p.alturaVista) / ALTURA_LINHA) + 4
  )

  const roda = (e: WheelEvent): void => {
    if (e.shiftKey) return
    p.onRolar(e.deltaY)
  }

  const gravar = (): void => {
    if (!editando) return
    const l = p.linhas.find((x) => x.chave === editando.chave)
    const c = p.colunas.find((x) => x.id === editando.col)
    setEditando(null)
    if (l && c?.editar && editando.valor !== c.editar.valor(l)) c.editar.gravar(l, editando.valor)
  }

  return (
    <div
      className="flex h-full flex-col overflow-x-auto overflow-y-hidden bg-bg"
      style={{ width: p.largura }}
      onWheel={roda}
    >
      <div style={{ width: Math.max(total, p.largura) }} className="flex h-full flex-col">
        {/* cabeçalho */}
        <div
          className="flex shrink-0 items-end border-b border-border-strong bg-bg-panel"
          style={{ height: ALTURA_CABECALHO }}
        >
          {p.colunas.map((c) => (
            <div
              key={c.id}
              title={c.dica}
              style={{ width: c.largura }}
              className={cn(
                'shrink-0 truncate px-2 pb-1.5 text-2xs font-mono uppercase tracking-wider text-text-dim',
                c.direita && 'text-right'
              )}
            >
              {c.titulo}
            </div>
          ))}
        </div>
        {/* linhas */}
        <div
          ref={corpo}
          className="relative min-h-0 flex-1 overflow-hidden"
          onScroll={(e) => {
            // só rolagem própria da grade (foco numa célula, busca do navegador) vira pedido; o eco da posição posta
            // por código — inclusive o limite, quando a grade é mais curta que a linha do tempo — é ignorado
            const top = (e.currentTarget as HTMLDivElement).scrollTop
            if (Math.abs(top - aplicado.current) <= 1) return
            aplicado.current = top
            p.onRolarPara(top)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            p.onMenu(null, e.clientX, e.clientY)
          }}
        >
          <div
            style={{
              height: Math.max(p.linhas.length * ALTURA_LINHA, p.alturaVista) + ALTURA_LINHA
            }}
            className="relative"
          >
            {p.linhas.slice(i0, i1 + 1).map((l, k) => {
              const i = i0 + k
              const sel = !!(l.id && p.selecionadas.has(l.id)) || p.selecionadas.has(l.chave)
              const forte = l.tipo === 'plano' || l.tipo === 'grupo'
              return (
                <div
                  key={l.chave}
                  data-linha={l.chave}
                  style={{ top: i * ALTURA_LINHA, height: ALTURA_LINHA }}
                  className={cn(
                    'absolute left-0 right-0 flex items-center border-b border-border text-xs',
                    sel ? 'bg-accent-glow' : 'hover:bg-bg-hover/60',
                    l.tipo === 'local' && 'text-text-muted',
                    l.tipo === 'servico' && 'text-text-muted'
                  )}
                  onPointerDown={(e) => {
                    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-editor]')) return
                    p.onSelecionar(l, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })
                  }}
                  onDoubleClick={(e) => {
                    if ((e.target as HTMLElement).closest('[data-editor]')) return
                    p.onAbrir(l)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    p.onMenu(l, e.clientX, e.clientY)
                  }}
                >
                  {p.colunas.map((c) => {
                    const emEdicao = editando?.chave === l.chave && editando.col === c.id
                    const editavel = !p.somenteLeitura && l.tipo === 'tarefa' && !!c.editar
                    if (c.id === 'nome') {
                      return (
                        <div
                          key={c.id}
                          style={{ width: c.largura, paddingLeft: 4 + l.nivel * RECUO }}
                          className="flex h-full shrink-0 items-center gap-1 overflow-hidden pr-2"
                        >
                          {p.comFilhas.has(l.chave) ? (
                            <button
                              type="button"
                              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-dim hover:bg-bg-hover hover:text-text"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={() => p.onAlternar(l)}
                              aria-label={p.recolhidas.has(l.chave) ? 'Expandir' : 'Recolher'}
                            >
                              {p.recolhidas.has(l.chave) ? (
                                <ChevronRight size={12} />
                              ) : (
                                <ChevronDown size={12} />
                              )}
                            </button>
                          ) : (
                            <span className="w-4 shrink-0" />
                          )}
                          <Icone l={l} cor={p.cores(l)} />
                          {emEdicao ? (
                            <Editor
                              valor={editando.valor}
                              onMudar={(v) => setEditando({ ...editando, valor: v })}
                              onGravar={gravar}
                              onCancelar={() => setEditando(null)}
                            />
                          ) : (
                            <span
                              className={cn(
                                'truncate',
                                forte && 'font-semibold text-text',
                                l.tipo === 'tarefa' && 'text-text'
                              )}
                              onClick={() =>
                                sel &&
                                editavel &&
                                c.editar &&
                                setEditando({ chave: l.chave, col: c.id, valor: c.editar.valor(l) })
                              }
                              title={l.texto}
                            >
                              {l.texto}
                            </span>
                          )}
                        </div>
                      )
                    }
                    const txt = c.texto(l)
                    return (
                      <div
                        key={c.id}
                        style={{ width: c.largura }}
                        className={cn(
                          'h-full shrink-0 truncate px-2 leading-[26px] tabular-nums',
                          c.direita && 'text-right',
                          c.id === 'numero'
                            ? 'font-mono text-2xs text-text-faint'
                            : forte
                              ? 'text-text-muted'
                              : 'text-text-muted',
                          editavel && 'cursor-text'
                        )}
                        title={txt}
                        onClick={() =>
                          sel &&
                          editavel &&
                          c.editar &&
                          setEditando({ chave: l.chave, col: c.id, valor: c.editar.valor(l) })
                        }
                      >
                        {emEdicao && c.editar?.tipo === 'opcoes' ? (
                          <EditorOpcoes
                            valor={editando.valor}
                            opcoes={c.editar.opcoes?.(l) ?? []}
                            onEscolher={(v) => {
                              setEditando(null)
                              if (v !== c.editar!.valor(l)) c.editar!.gravar(l, v)
                            }}
                            onCancelar={() => setEditando(null)}
                          />
                        ) : emEdicao ? (
                          <Editor
                            valor={editando.valor}
                            direita={c.direita}
                            onMudar={(v) => setEditando({ ...editando, valor: v })}
                            onGravar={gravar}
                            onCancelar={() => setEditando(null)}
                          />
                        ) : (
                          txt
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function Icone({ l, cor }: { l: LinhaGantt; cor: string }): ReactNode {
  if (l.tipo === 'plano') return <LayoutList size={12} className="shrink-0 text-accent" />
  if (l.tipo === 'grupo') return <FolderTree size={12} className="shrink-0 text-text-dim" />
  if (l.tipo === 'local') return <MapPin size={12} className="shrink-0" style={{ color: cor }} />
  if (l.tipo === 'servico') return <Wrench size={11} className="shrink-0" style={{ color: cor }} />
  return <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: cor }} />
}

function EditorOpcoes({
  valor,
  opcoes,
  onEscolher,
  onCancelar
}: {
  valor: string
  opcoes: { valor: string; rotulo: string }[]
  onEscolher: (v: string) => void
  onCancelar: () => void
}): ReactNode {
  const ref = useRef<HTMLSelectElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return (
    <select
      ref={ref}
      data-editor
      defaultValue={valor}
      onChange={(e) => onEscolher(e.target.value)}
      onBlur={onCancelar}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') onCancelar()
      }}
      className="h-5 w-full min-w-0 rounded-sm border border-accent bg-bg-elevated px-1 text-xs text-text outline-none"
    >
      {opcoes.map((o) => (
        <option key={o.valor} value={o.valor}>
          {o.rotulo}
        </option>
      ))}
    </select>
  )
}

function Editor({
  valor,
  direita,
  onMudar,
  onGravar,
  onCancelar
}: {
  valor: string
  direita?: boolean
  onMudar: (v: string) => void
  onGravar: () => void
  onCancelar: () => void
}): ReactNode {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <input
      ref={ref}
      data-editor
      value={valor}
      onChange={(e) => onMudar(e.target.value)}
      onBlur={onGravar}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') onGravar()
        else if (e.key === 'Escape') onCancelar()
      }}
      className={cn(
        'h-5 w-full min-w-0 rounded-sm border border-accent bg-bg-elevated px-1 text-xs text-text outline-none',
        direita && 'text-right'
      )}
    />
  )
}

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'
import { useCamadaAberta } from './camada-modal'
import { cn } from '@/lib/utils'

export interface OpcaoLista {
  valor: string
  rotulo: string
  /** Texto de apoio à direita (ex.: "início do local", "faixa da planilha: 120 m³"). */
  dica?: string
}

interface Props {
  opcoes: readonly OpcaoLista[]
  /** `valor` da opção escolhida (ou o texto livre aceito). */
  valor: string | null
  aoEscolher: (opcao: OpcaoLista) => void
  /** Nome acessível do campo. */
  rotulo: string
  placeholder?: string
  /** Texto da busca que não está na lista mas é aceito (ex.: uma estaca digitada): vira a primeira opção. */
  livre?: (texto: string) => OpcaoLista | null
  invalido?: boolean
  title?: string
  className?: string
  /** Quantas opções mostrar sem busca; o resto aparece ao filtrar. */
  maximo?: number
}

const normalizar = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Lista com busca para escolher um valor (combobox). Abre num portal preso ao campo, então funciona dentro de
 * tabela com rolagem e de diálogo; setas, Enter, Esc (fecha só a lista) e Tab como num select.
 */
export function ListaPesquisavel({
  opcoes,
  valor,
  aoEscolher,
  rotulo,
  placeholder = 'Escolha',
  livre,
  invalido,
  title,
  className,
  maximo = 300
}: Props): ReactNode {
  const [aberta, setAberta] = useState(false)
  const [busca, setBusca] = useState('')
  const [ativo, setAtivo] = useState(0)
  const [pos, setPos] = useState<{
    top: number
    left: number
    largura: number
    acima: boolean
  } | null>(null)
  const botao = useRef<HTMLButtonElement>(null)
  const caixa = useRef<HTMLDivElement>(null)
  const lista = useRef<HTMLDivElement>(null)
  const uid = useId()
  const listaId = `${uid}-lista`
  useCamadaAberta(aberta)

  const escolhida = opcoes.find((o) => o.valor === valor) ?? null
  const textoBotao = escolhida?.rotulo ?? valor ?? ''

  const { visiveis, ocultas } = useMemo(() => {
    const q = normalizar(busca.trim())
    const achadas = q
      ? opcoes.filter((o) => normalizar(`${o.rotulo} ${o.dica ?? ''}`).includes(q))
      : opcoes
    const extra = q && livre ? livre(busca.trim()) : null
    const comLivre =
      extra && !achadas.some((o) => o.valor === extra.valor) ? [extra, ...achadas] : achadas
    return { visiveis: comLivre.slice(0, maximo), ocultas: Math.max(0, comLivre.length - maximo) }
  }, [opcoes, busca, livre, maximo])
  const indiceAtivo = Math.min(ativo, Math.max(0, visiveis.length - 1))

  useLayoutEffect(() => {
    if (!aberta || !botao.current) return
    const atualizar = (): void => {
      const r = botao.current!.getBoundingClientRect()
      const altura = caixa.current?.offsetHeight ?? 320
      const acima = r.bottom + 4 + altura > window.innerHeight - 8 && r.top - 4 - altura > 8
      const largura = Math.max(r.width, 240)
      setPos({
        top: acima ? r.top - 4 - altura : r.bottom + 4,
        left: Math.max(8, Math.min(r.left, window.innerWidth - largura - 8)),
        largura,
        acima
      })
    }
    atualizar()
    const raf = requestAnimationFrame(atualizar)
    window.addEventListener('resize', atualizar)
    window.addEventListener('scroll', atualizar, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', atualizar)
      window.removeEventListener('scroll', atualizar, true)
    }
  }, [aberta])

  useEffect(() => {
    if (!aberta) return
    const fora = (e: MouseEvent): void => {
      const t = e.target as Node
      if (botao.current?.contains(t) || caixa.current?.contains(t)) return
      fechar(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [aberta])

  useEffect(() => {
    if (!aberta) return
    lista.current
      ?.querySelector<HTMLElement>('[data-ativo="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [aberta, indiceAtivo])

  const abrir = (): void => {
    setBusca('')
    setAtivo(
      Math.max(
        0,
        opcoes.findIndex((o) => o.valor === valor)
      )
    )
    setAberta(true)
  }
  function fechar(devolverFoco: boolean): void {
    setAberta(false)
    setPos(null)
    if (devolverFoco) botao.current?.focus()
  }
  const escolher = (o: OpcaoLista): void => {
    aoEscolher(o)
    fechar(true)
  }
  const naBusca = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!visiveis.length) return
      const passo = e.key === 'ArrowDown' ? 1 : -1
      setAtivo((indiceAtivo + passo + visiveis.length) % visiveis.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const o = visiveis[indiceAtivo]
      if (o) escolher(o)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      fechar(true)
    } else if (e.key === 'Tab') {
      fechar(false)
    }
  }

  return (
    <>
      <button
        ref={botao}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={aberta}
        aria-controls={aberta ? listaId : undefined}
        aria-label={textoBotao ? `${rotulo}: ${textoBotao}` : rotulo}
        aria-invalid={invalido || undefined}
        title={title}
        onClick={() => (aberta ? fechar(false) : abrir())}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !aberta) {
            e.preventDefault()
            abrir()
          }
        }}
        className={cn(
          'flex h-8 w-full min-w-0 items-center gap-1 rounded border border-border-strong bg-bg-panel px-2 text-left text-sm',
          'hover:border-border-accent focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
          'aria-[invalid=true]:border-danger aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-danger',
          className
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate tabular', !textoBotao && 'text-text-dim')}>
          {textoBotao || placeholder}
        </span>
        <ChevronDown size={12} className="shrink-0 text-text-muted" aria-hidden />
      </button>
      {aberta
        ? createPortal(
            <div
              ref={caixa}
              style={{
                position: 'fixed',
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
                width: pos?.largura,
                zIndex: 1000
              }}
              className="flex max-h-[min(360px,60vh)] flex-col overflow-hidden rounded border border-border-strong bg-[color:var(--popover)] shadow-[var(--sombra-flutuante)]"
            >
              <div className="flex items-center gap-2 border-b border-border px-2.5">
                <Search size={14} className="shrink-0 text-text-dim" aria-hidden />
                <input
                  autoFocus
                  role="combobox"
                  aria-expanded
                  aria-controls={listaId}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    visiveis[indiceAtivo] ? `${uid}-op-${indiceAtivo}` : undefined
                  }
                  aria-label={`Buscar: ${rotulo}`}
                  value={busca}
                  onChange={(e) => {
                    setBusca(e.target.value)
                    setAtivo(0)
                  }}
                  onKeyDown={naBusca}
                  placeholder="Buscar ou digitar"
                  className="h-8 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-dim"
                />
              </div>
              <div
                ref={lista}
                id={listaId}
                role="listbox"
                aria-label={rotulo}
                className="flex-1 overflow-auto p-1"
              >
                {visiveis.length === 0 ? (
                  <div className="px-2 py-2 text-sm text-text-muted">Nada encontrado.</div>
                ) : null}
                {visiveis.map((o, i) => {
                  const marcada = o.valor === valor
                  return (
                    <div
                      key={`${o.valor}-${i}`}
                      id={`${uid}-op-${i}`}
                      role="option"
                      aria-selected={marcada}
                      data-ativo={i === indiceAtivo}
                      onMouseMove={() => setAtivo(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => escolher(o)}
                      className={cn(
                        'flex min-h-7 cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm',
                        i === indiceAtivo ? 'bg-bg-hover' : '',
                        marcada && 'font-medium'
                      )}
                    >
                      <span className="w-3 shrink-0 text-accent">
                        {marcada ? <Check size={12} aria-hidden /> : null}
                      </span>
                      <span className="whitespace-nowrap tabular text-text">{o.rotulo}</span>
                      {o.dica ? (
                        <span className="ml-auto truncate pl-2 text-xs text-text-muted">
                          {o.dica}
                        </span>
                      ) : null}
                    </div>
                  )
                })}
                {ocultas > 0 ? (
                  <div className="px-2 py-1.5 text-xs text-text-muted">
                    Mais {ocultas.toLocaleString('pt-BR')}: digite para filtrar.
                  </div>
                ) : null}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}

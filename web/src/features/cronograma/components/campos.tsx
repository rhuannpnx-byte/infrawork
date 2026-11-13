/** Peças comuns dos diálogos do cronograma. */
import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject
} from 'react'
import { cn } from '@/lib/utils'

export function Campo({
  rotulo,
  dica,
  erro,
  children,
  className
}: {
  rotulo: string
  dica?: string
  /** Mensagem de erro do campo: aparece abaixo do controle, que fica marcado como inválido. */
  erro?: string | null
  children: ReactNode
  className?: string
}): ReactNode {
  const idErro = `${useId()}-erro`
  const filho =
    erro && isValidElement(children) ? (children as ReactElement<Record<string, unknown>>) : null
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label className="flex flex-col gap-1" title={dica}>
        <span className="text-sm font-medium text-text">{rotulo}</span>
        {filho
          ? cloneElement(filho, { 'aria-invalid': true, 'aria-describedby': idErro })
          : children}
      </label>
      {erro ? (
        <span id={idErro} role="alert" className="text-xs font-medium text-danger">
          {erro}
        </span>
      ) : null}
    </div>
  )
}

export interface ErroForm {
  /** erro geral (faixa no topo) */
  geral: string | null
  /** erro de um campo, pelo nome dado em `falhar` */
  de: (campo: string) => string | null
  /** `campo` ausente: erro geral */
  falhar: (msg: string, campo?: string) => void
  limpar: () => void
  /** contêiner do formulário: o foco vai ao primeiro campo inválido dele */
  caixa: RefObject<HTMLDivElement | null>
}

/** Erro de validação de um diálogo: no campo quando há um campo, na faixa quando é geral. */
export function useErroForm(): ErroForm {
  const [erro, setErro] = useState<{ msg: string; campo?: string; seq: number } | null>(null)
  const caixa = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (erro?.campo)
      caixa.current?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)')?.focus()
  }, [erro])
  return {
    caixa,
    geral: erro && !erro.campo ? erro.msg : null,
    de: (campo) => (erro?.campo === campo ? erro.msg : null),
    falhar: (msg, campo) => setErro({ msg, campo, seq: Date.now() }),
    limpar: () => setErro(null)
  }
}

/** Enter num campo de texto envia o formulário (os diálogos do cronograma não são `<form>`). */
export const enterEnvia =
  (enviar: () => void) =>
  (e: KeyboardEvent<HTMLElement>): void => {
    const alvo = e.target as HTMLElement
    if (e.key !== 'Enter' || e.defaultPrevented || e.shiftKey || e.ctrlKey || e.altKey) return
    if (!(alvo instanceof HTMLInputElement)) return
    if (['checkbox', 'radio', 'color', 'file', 'button', 'submit'].includes(alvo.type)) return
    e.preventDefault()
    enviar()
  }

export function Caixa({
  marcado,
  onMudar,
  children,
  desabilitado,
  dica
}: {
  marcado: boolean
  onMudar: (v: boolean) => void
  children: ReactNode
  desabilitado?: boolean
  dica?: string
}): ReactNode {
  return (
    <label
      className={cn(
        'flex items-start gap-2 text-sm',
        desabilitado ? 'text-text-dim' : 'text-text cursor-pointer'
      )}
      title={dica}
    >
      <input
        type="checkbox"
        className="mt-0.5 accent-[var(--accent)]"
        checked={marcado}
        disabled={desabilitado}
        onChange={(e) => onMudar(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  )
}

export function Secao({
  titulo,
  children,
  acoes
}: {
  titulo: string
  children: ReactNode
  acoes?: ReactNode
}): ReactNode {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between border-b border-border pb-1">
        <h3 className="text-md font-semibold text-text">{titulo}</h3>
        {acoes}
      </div>
      {children}
    </section>
  )
}

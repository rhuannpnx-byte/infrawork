import { useRef, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { fmtBRL, fmtQtd, parseBR } from '@/lib/money'
import { detalheDoErro } from '@/features/orcamento/lib/erro'

interface Props {
  value: string
  onCommit: (value: string) => Promise<void> | void
  /** Tipo HTML do input (default 'text'); usa inputMode="decimal" para números. */
  numeric?: boolean
  /** Quando true, formata como BRL no blur e mostra raw no focus. Implica numeric. */
  money?: boolean
  /** Quando true, formata como 1.234,56 (BR) no blur e mostra raw no focus. Implica numeric. */
  qtd?: boolean
  placeholder?: string
  className?: string
  disabled?: boolean
  /** Debounce em ms — default 600. */
  debounceMs?: number
  align?: 'left' | 'right'
  /** Nome do campo para leitor de tela (a célula não tem rótulo visível). */
  rotulo?: string
  /** Confere o texto digitado antes de gravar; devolve a frase do erro ou null. */
  validar?: (texto: string) => string | null
  /** Motivo de o campo estar desabilitado. */
  motivoDesabilitado?: string
}

/**
 * Célula editável com auto-commit após `debounceMs` parado, com indicador
 * visual de save em progresso e rollback em erro.
 */
export function PlanOrcInlineCell({
  value,
  onCommit,
  numeric,
  money,
  qtd,
  placeholder,
  className,
  disabled,
  debounceMs = 600,
  align = 'left',
  rotulo,
  validar,
  motivoDesabilitado
}: Props): ReactNode {
  const isNum = numeric || money || qtd
  // `lastUpstream` rastreia o último valor recebido por props. Quando muda
  // (e não estamos no meio de um save local), aceitamos o valor novo —
  // evita useEffect+setState que viola react-hooks/set-state-in-effect.
  const [local, setLocal] = useState(value)
  const [lastUpstream, setLastUpstream] = useState(value)
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Em campos numéricos, aceita "1.234,56" (BR) ou "1234.56" (raw) e
  // emite sempre raw com ponto decimal pro parent (o parent tipicamente
  // chama Number(val.replace(',', '.')) — strip de pontos garante que
  // "1.234,56" não fique "1.234.56").
  const normalizeNumericInput = (s: string): string => {
    const trimmed = s.trim()
    if (trimmed === '') return ''
    // Heurística: se tem vírgula, é BR → parse com parseBR.
    if (trimmed.includes(',')) {
      const d = parseBR(trimmed)
      return d.toString()
    }
    // Sem vírgula: pode ser "1234.56" (raw) ou "1.234" (BR sem decimais).
    // Se tem múltiplos pontos → BR; senão deixa como está.
    const dots = (trimmed.match(/\./g) ?? []).length
    if (dots > 1) {
      return trimmed.replace(/\./g, '')
    }
    return trimmed
  }

  // Texto para editar: vírgula decimal e sem separador de milhar.
  const textoEdicao = (s: string): string => {
    if (!isNum || s.trim() === '') return s
    const n = Number(normalizeNumericInput(s))
    return isNaN(n) ? s : String(n).replace('.', ',')
  }

  if (value !== lastUpstream && !saving) {
    setLastUpstream(value)
    setLocal(focused ? textoEdicao(value) : value)
  }

  const falhar = (mensagem: string): void => {
    setErro(mensagem)
    setLocal(focused ? textoEdicao(value) : value) // rollback
    toast.error(mensagem)
  }

  /** `aoSair`: o campo perdeu o foco. Enquanto se digita, texto inválido só espera. */
  const commit = async (next: string, aoSair: boolean): Promise<void> => {
    const outbound = isNum ? normalizeNumericInput(next) : next
    if (outbound === value) return
    if (isNum && outbound !== '' && value !== '' && Number(outbound) === Number(value)) return
    const invalido = validar?.(next.trim()) ?? null
    if (invalido) {
      if (aoSair) falhar(invalido)
      return
    }
    setSaving(true)
    setErro(null)
    try {
      await onCommit(outbound)
    } catch (err) {
      const detalhe = detalheDoErro(err) ?? ''
      falhar(detalhe || `Não foi possível salvar${rotulo ? ` (${rotulo})` : ''}. Tente de novo.`)
    } finally {
      setSaving(false)
    }
  }

  const onChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setLocal(e.target.value)
    setErro(null)
    if (timer.current) clearTimeout(timer.current)
    const next = e.target.value
    timer.current = setTimeout(() => {
      void commit(next, false)
    }, debounceMs)
  }

  const onBlur = async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    setFocused(false)
    await commit(local, true)
  }

  // Display formatado quando desfocado; texto de edição quando focado.
  // Usa normalizeNumericInput para aceitar tanto "1725622.35" (DB raw) quanto
  // "1.725.622,35" (BR) — parseBR puro tratava todos os pontos como milhar e
  // inflava o valor por 100/1000 quando vinha do banco.
  let display = local
  if (!focused && local.trim() !== '') {
    const normalized = isNum ? normalizeNumericInput(local) : local
    const n = Number(normalized)
    if (!isNaN(n)) {
      if (money) display = fmtBRL(n)
      else if (qtd) display = fmtQtd(n)
    }
  }

  return (
    <div className="relative w-full">
      <input
        type="text"
        inputMode={isNum ? 'decimal' : undefined}
        value={display}
        placeholder={placeholder}
        aria-label={rotulo}
        aria-busy={saving || undefined}
        aria-invalid={erro ? true : undefined}
        title={erro ?? (disabled ? motivoDesabilitado : undefined)}
        disabled={disabled}
        readOnly={saving}
        onFocus={() => {
          setFocused(true)
          setLocal((l) => textoEdicao(l))
        }}
        onChange={onChange}
        onBlur={onBlur}
        className={cn(
          'h-6 w-full bg-transparent border border-transparent rounded px-1 text-xs',
          'hover:border-border focus:border-accent focus:bg-bg-elevated focus:outline-none',
          'disabled:text-text-muted tabular-nums',
          align === 'right' && 'text-right',
          erro && 'border-danger',
          className
        )}
      />
      {saving ? (
        <Loader2
          size={12}
          className="absolute right-1 top-1/2 -translate-y-1/2 text-accent animate-spin"
        />
      ) : null}
    </div>
  )
}

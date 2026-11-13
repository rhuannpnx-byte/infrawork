import type { InputHTMLAttributes } from 'react'
import { ChevronRight } from 'lucide-react'
import { Input } from '@/core/ui/Input'
import { cn } from '@/lib/cn'
import { formatNumberBR, parseNumberBR } from '@/lib/numero'

/** Campos dos formulários de campo (herdados do Monito): número com máscara BR, texto, leitura e seletor. */

/** Rótulo em caixa alta; o que vem entre parênteses (unidade: m³, t, km) fica como foi escrito. */
export function RotuloCampo({ children, htmlFor }: { children: string; htmlFor?: string }) {
  return (
    <label className="rotulo block" htmlFor={htmlFor}>
      {children.split(/(\([^)]*\))/).map((parte, i) =>
        parte.startsWith('(') ? (
          <span key={i} className="normal-case">
            {parte}
          </span>
        ) : (
          parte
        ),
      )}
    </label>
  )
}

/**
 * Input numérico com máscara brasileira:
 *  - Operador digita só dígitos ("123456") → display vira "123.456"
 *  - Digita vírgula → vira separador decimal ("1234,5" → "1.234,5")
 *  - Valor armazenado externamente continua em formato canônico com ponto
 *    decimal ("1234.5") — `parseNum()` da validação não precisa mudar.
 *  - Aceita até 4 casas decimais (qtd material pode ser fracionário).
 */
export function NumericField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (s: string) => void
}) {
  const display = value === '' ? '' : formatNumberBR(value.replace('.', ','))
  return (
    <div>
      <RotuloCampo>{label}</RotuloCampo>
      <Input
        type="text"
        inputMode="decimal"
        value={display}
        onChange={(e) => {
          const formatted = formatNumberBR(e.target.value)
          onChange(parseNumberBR(formatted))
        }}
        className="mt-1"
      />
    </div>
  )
}

export function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  autoComplete,
}: {
  label: string
  value: string
  onChange: (s: string) => void
  placeholder?: string
  /** teclado do celular; estaca e km usam `tecladoPosicao` (lib/estaca) */
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode']
  autoComplete?: string
}) {
  return (
    <div>
      <RotuloCampo>{label}</RotuloCampo>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        {...(inputMode ? { autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false } : {})}
        className="mt-1"
      />
    </div>
  )
}

/**
 * Linha read-only com label uppercase + valor. Usada pra unidade do serviço,
 * material vinculado e unidade do material — campos que o operador não escolhe,
 * vêm do cadastro.
 */
export function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-surface-variant px-3 py-2">
      <RotuloCampo>{label}</RotuloCampo>
      <p className="mt-0.5 text-on-surface">{value}</p>
    </div>
  )
}

export function PickerField({
  label,
  value,
  onClick,
  empty,
  opcional,
  hint,
}: {
  label: string
  value: string
  onClick: () => void
  /** obrigatório e ainda sem valor: contorno de aviso */
  empty?: boolean
  /** opcional e ainda sem valor: só o texto mais claro */
  opcional?: boolean
  hint?: string
}) {
  return (
    <div>
      <RotuloCampo>{label}</RotuloCampo>
      <div className="mt-1">
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'w-full rounded-md border bg-bg-panel px-3 text-left text-base',
            'flex min-h-touch items-center justify-between gap-2',
            'transition-colors',
            empty ? 'border-warn hover:border-warn' : 'border-border-strong hover:border-accent',
          )}
        >
          <span
            className={cn('truncate', empty || opcional ? 'text-on-surface-dim' : 'text-on-surface')}
          >
            {value}
          </span>
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-on-surface-dim" />
        </button>
      </div>
      {hint && <p className="mt-1 text-xs text-on-surface-dim">{hint}</p>}
    </div>
  )
}

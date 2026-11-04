import { ChevronRight } from 'lucide-react'
import { Input } from '@/core/ui/Input'
import { cn } from '@/lib/cn'
import { formatNumberBR, parseNumberBR } from '@/lib/numero'



/** Campos dos formulários de campo (herdados do Monito): número com máscara BR, texto, leitura e seletor. */

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
      <label className="text-xs font-medium uppercase text-on-surface-dim">{label}</label>
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
}: {
  label: string
  value: string
  onChange: (s: string) => void
  placeholder?: string
}) {
  return (
    <div>
      <label className="text-xs font-medium uppercase text-on-surface-dim">{label}</label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
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
      <p className="text-xs font-medium uppercase text-on-surface-dim">{label}</p>
      <p className="mt-0.5 text-on-surface">{value}</p>
    </div>
  )
}

export function PickerField({
  label,
  value,
  onClick,
  empty,
  hint,
}: {
  label: string
  value: string
  onClick: () => void
  empty?: boolean
  hint?: string
}) {
  return (
    <div>
      <label className="text-xs font-medium uppercase text-on-surface-dim">{label}</label>
      <div className="mt-1">
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'w-full rounded-lg border bg-surface-1 px-3 text-left',
            'flex min-h-touch items-center justify-between',
            'transition-colors',
            empty ? 'border-warn/60 hover:border-warn' : 'border-border hover:border-accent/60',
          )}
        >
          <span className={cn('truncate', empty ? 'text-on-surface-dim' : 'text-on-surface')}>
            {value}
          </span>
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-on-surface-dim" />
        </button>
      </div>
      {hint && <p className="mt-1 text-xs text-on-surface-dim">{hint}</p>}
    </div>
  )
}


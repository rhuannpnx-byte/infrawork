import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { InputMascara, type MascaraProps } from './input-mascara'

/**
 * Campo de texto do sistema. Com `mascara`, formata enquanto se digita (ver `InputMascara`): campo de número usa
 * `mascara="decimal"` com as `casas` do dado, ou `mascara="inteiro"`; nunca `type="number"`.
 */
export type InputProps = InputHTMLAttributes<HTMLInputElement> & Partial<MascaraProps>

const CLASSES = [
  'flex h-8 w-full rounded border border-border-strong bg-bg-panel px-2.5 text-sm text-text',
  'placeholder:text-text-dim focus-visible:outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'aria-[invalid=true]:border-danger aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-danger'
]

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, mascara, casas, casasMin, negativo, formatoSemFoco, ...props }, ref) => {
    if (mascara) {
      const { value, defaultValue, ...resto } = props
      return (
        <InputMascara
          ref={ref}
          mascara={mascara}
          casas={casas}
          casasMin={casasMin}
          negativo={negativo}
          formatoSemFoco={formatoSemFoco}
          value={value as string | number | undefined}
          defaultValue={defaultValue as string | number | undefined}
          className={cn(CLASSES, className)}
          {...resto}
        />
      )
    }
    return <input ref={ref} type={type} className={cn(CLASSES, className)} {...props} />
  }
)
Input.displayName = 'Input'

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface CampoProps {
  rotulo: string
  /** Texto de apoio abaixo do controle (formato esperado, de onde vem o valor). */
  dica?: ReactNode
  /** Mensagem de erro do campo; quando presente, substitui a dica e marca o controle como inválido. */
  erro?: string | null
  obrigatorio?: boolean
  className?: string
  /** Um único controle (Input, Select, textarea…): recebe id, aria-invalid e aria-describedby. */
  children: ReactNode
}

/**
 * Campo de formulário: rótulo, controle, dica e erro ligados para leitor de tela. O erro aparece no campo, não
 * só no aviso flutuante.
 */
export function Campo({
  rotulo,
  dica,
  erro,
  obrigatorio,
  className,
  children
}: CampoProps): ReactNode {
  const base = useId()
  const filho = isValidElement(children)
    ? (children as ReactElement<Record<string, unknown>>)
    : null
  const id = (filho?.props.id as string | undefined) ?? `${base}-campo`
  const idApoio = `${base}-apoio`
  const apoio = erro || dica

  return (
    <div className={cn('flex flex-col gap-1 min-w-0', className)}>
      <label htmlFor={id} className="text-sm font-medium text-text">
        {rotulo}
        {obrigatorio ? (
          <span className="text-danger" aria-hidden>
            {' '}
            *
          </span>
        ) : null}
      </label>
      {filho
        ? cloneElement(filho, {
            id,
            'aria-invalid': erro ? true : undefined,
            'aria-describedby': apoio ? idApoio : undefined,
            'aria-required': obrigatorio || undefined
          })
        : children}
      {apoio ? (
        <span
          id={idApoio}
          role={erro ? 'alert' : undefined}
          className={cn('text-xs', erro ? 'text-danger font-medium' : 'text-text-muted')}
        >
          {erro || dica}
        </span>
      ) : null}
    </div>
  )
}

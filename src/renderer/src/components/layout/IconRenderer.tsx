import * as Lucide from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import { HelpCircle } from 'lucide-react'
import type { ReactElement } from 'react'

function toPascalCase(s: string): string {
  return s
    .split(/[-_\s]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

type LucideIconRef = (props: LucideProps) => ReactElement

export function Icon({ name, ...props }: { name: string } & LucideProps): ReactElement {
  const pascal = toPascalCase(name)
  const lib = Lucide as unknown as Record<string, LucideIconRef | undefined>
  const Component = lib[pascal] ?? (HelpCircle as unknown as LucideIconRef)
  return <Component {...props} />
}

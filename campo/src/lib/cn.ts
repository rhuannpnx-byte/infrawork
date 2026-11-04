import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Utility para concatenar classes Tailwind sem conflito. Padrão shadcn/ui.
 * Usa clsx (suporta condicionais) + tailwind-merge (resolve `p-2 p-4` em `p-4`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

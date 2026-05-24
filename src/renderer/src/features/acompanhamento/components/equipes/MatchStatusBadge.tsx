import { type ReactNode } from 'react'
import { Check, AlertCircle, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MatchOrigem } from '@/types/acompanhamento'

interface Props {
  vinculadoA: string | null
  origem?: MatchOrigem | null
  sugestao?: { nome: string; confianca: number } | null
}

export function MatchStatusBadge({ vinculadoA, origem, sugestao }: Props): ReactNode {
  if (vinculadoA) {
    return (
      <span className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-mono',
        'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
      )}>
        <Check size={10} /> Vinculada · {vinculadoA}
        {origem === 'auto' && <span className="text-emerald-400/60 ml-1">(auto)</span>}
      </span>
    )
  }
  if (origem === 'rejeitado') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-mono bg-text-dim/10 text-text-dim border border-border line-through">
        Não vincular
      </span>
    )
  }
  if (sugestao) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-mono bg-amber-500/10 text-amber-300 border border-amber-500/30">
        <Sparkles size={10} /> Sugestão: {sugestao.nome} ({Math.round(sugestao.confianca * 100)}%)
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-mono bg-text-dim/10 text-text-dim border border-border">
      <AlertCircle size={10} /> Sem vínculo
    </span>
  )
}

import { type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Aditivos, reajustes e planilha inicial são abertos a partir da planilha orçamentária. */
export function VoltarPlanilhaButton(): ReactNode {
  const navigate = useNavigate()
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => navigate({ to: '/orcamento/obra/plan-orc' })}
      title="Voltar para a planilha orçamentária"
    >
      <ArrowLeft size={12} aria-hidden /> Voltar para a planilha
    </Button>
  )
}

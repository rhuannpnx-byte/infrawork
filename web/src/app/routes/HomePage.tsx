import { type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useUIStore } from '@/stores/ui-store'
import { useObraStore } from '@/stores/obra-store'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { rotuloStatusObra } from '@/features/gerencial/lib/status-obra'
import { PainelObra } from '@/features/painel/PainelObra'

/** Início: o painel da obra em uso; sem obra, a lista das obras para escolher. */
export function HomePage(): ReactNode {
  const { obra } = useCurrentScope()
  return obra ? <PainelObra obraId={obra.id} /> : <EscolherObra />
}

function EscolherObra(): ReactNode {
  const openModal = useUIStore((s) => s.openModal)
  const setObraId = useObraStore((s) => s.setObraId)
  const { obrasNaEmpresa, precisaSelecionarEmpresa } = useCurrentScope()

  return (
    <div className="h-full w-full overflow-auto bg-bg">
      <div className="max-w-[900px] mx-auto px-5 py-8 flex flex-col gap-4">
        <header>
          <h1 className="text-3xl font-semibold tracking-[-0.01em] text-text">Escolha a obra</h1>
          <p className="text-sm text-text-muted mt-1">
            O painel, o orçamento, o planejamento e o acompanhamento são sempre de uma obra.
          </p>
        </header>

        {precisaSelecionarEmpresa ? (
          <div className="bg-bg-panel border border-border rounded px-4 py-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-text">Primeiro selecione a empresa.</span>
            <Button onClick={() => openModal('projectSwitcher')}>Selecionar empresa</Button>
          </div>
        ) : obrasNaEmpresa.length === 0 ? (
          <div className="bg-bg-panel border border-border rounded px-4 py-4 text-sm text-text-muted">
            Nenhuma obra disponível para o seu usuário nesta empresa.
          </div>
        ) : (
          <ul className="bg-bg-panel border border-border rounded">
            {obrasNaEmpresa.map((o) => (
              <li key={o.id} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => setObraId(o.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bg-hover"
                >
                  <span className="tabular font-semibold text-accent shrink-0">{o.codigo}</span>
                  <span className="flex-1 min-w-0 truncate text-sm text-text">{o.nome}</span>
                  <Badge variant="outline">{rotuloStatusObra(o.status)}</Badge>
                  <ArrowRight size={14} className="text-text-dim shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

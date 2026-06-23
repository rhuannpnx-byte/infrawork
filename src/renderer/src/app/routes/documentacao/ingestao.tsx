import { useState, type ReactNode } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { UploadCloud, FilePlus2 } from 'lucide-react'
import { RequireRole } from '@/components/layout/RequireRole'
import { RequireObra } from '@/components/layout/RequireObra'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useContratos } from '@/features/documentacao/hooks/contratos'
import { IngestaoDialog } from '@/features/documentacao/modals/IngestaoDialog'

export function DocumentacaoIngestaoPage(): ReactNode {
  return (
    <RequireRole allow={['god']} pageTitle="Ingestão">
      <RequireObra pageTitle="Ingestão">
        <Inner />
      </RequireObra>
    </RequireRole>
  )
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const navigate = useNavigate()
  const { data: contratos = [], isLoading } = useContratos(obraId)
  // Contrato pré-selecionado quando chegamos a partir da tela de um contrato.
  const search = useSearch({ strict: false }) as { contrato?: string }
  const [open, setOpen] = useState(false)
  // Seleção do usuário (null = ainda não mexeu → usa o default derivado).
  const [escolhido, setEscolhido] = useState<string | null>(null)

  // Default derivado (sem efeito): 1) contrato da navegação; 2) primeiro da lista.
  const padrao =
    search.contrato && contratos.some((c) => c.id === search.contrato)
      ? search.contrato
      : (contratos[0]?.id ?? '')
  const contratoId = escolhido ?? padrao

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Ingestão"
        subtitle="Traga documentos de pastas locais/rede/OneDrive ou arraste-e-solte. Online-only é hidratado."
      />
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <p className="text-xs text-text-muted">Carregando…</p>
        ) : contratos.length === 0 ? (
          <EmptyState
            icon="file-text"
            title="Cadastre um contrato primeiro"
            description="Os documentos são pendurados em um contrato. Crie o contrato da obra para liberar a ingestão."
            action={
              <Button
                variant="default"
                size="sm"
                onClick={() => navigate({ to: '/documentacao/contratos' })}
              >
                <FilePlus2 size={11} /> Ir para Contratos
              </Button>
            }
          />
        ) : (
          <div className="max-w-xl space-y-4">
            <div className="rounded border border-border bg-bg-panel p-4 space-y-3">
              <div>
                <Label htmlFor="ing-contrato">Contrato de destino</Label>
                <Select
                  id="ing-contrato"
                  value={contratoId}
                  onChange={(e) => setEscolhido(e.target.value)}
                >
                  {contratos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.numero}
                      {c.contratante ? ` — ${c.contratante}` : ''}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                variant="default"
                size="sm"
                onClick={() => setOpen(true)}
                disabled={!contratoId}
              >
                <UploadCloud size={12} /> Iniciar ingestão
              </Button>
            </div>
            <p className="text-2xs text-text-dim font-mono leading-relaxed">
              O arquivo original na origem nunca é alterado (WORM). A classificação automática na
              taxonomia e o OCR entram na camada de IA (fase seguinte) — por ora, escolha a
              categoria manualmente na janela de ingestão.
            </p>
          </div>
        )}
      </div>

      {contratoId ? (
        <IngestaoDialog
          open={open}
          onOpenChange={setOpen}
          obraId={obraId}
          contratoId={contratoId}
        />
      ) : null}
    </div>
  )
}

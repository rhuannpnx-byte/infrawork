import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { RotateCcw, Save, Info } from 'lucide-react'
import { RequireRole } from '@/components/layout/RequireRole'
import { RequireObra } from '@/components/layout/RequireObra'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useTemplate, useSalvarTemplate } from '@/features/documentacao/hooks/template'
import { ReprocessarButton } from '@/features/documentacao/components/workspace/ReprocessarButton'
import { PROMPT_CATALOGO, type PromptKey } from '@/types/documentacao-prompts'
import type { Template } from '@/types/documentacao-template'

/** Configuração AMIGÁVEL dos system prompts de processamento (editáveis por obra). */
export function DocumentacaoPromptsPage(): ReactNode {
  return (
    <RequireRole allow={['god']} pageTitle="Prompts de IA">
      <RequireObra pageTitle="Prompts de IA">
        <Inner />
      </RequireObra>
    </RequireRole>
  )
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const { data: template } = useTemplate(obraId)
  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Prompts de IA"
        subtitle="Instruções (system prompts) de cada etapa de processamento — edite e reprocesse para aplicar retroativamente."
        actions={<ReprocessarButton obraId={obraId} />}
      />
      <div className="flex-1 min-h-0 overflow-auto">
        {template ? (
          <Editor key={template.versao} obraId={obraId} template={template} />
        ) : (
          <p className="p-5 text-xs text-text-dim">Carregando template…</p>
        )}
      </div>
    </div>
  )
}

function Editor({ obraId, template }: { obraId: string; template: Template }): ReactNode {
  const salvar = useSalvarTemplate()
  const [vals, setVals] = useState<Record<PromptKey, string>>(() => {
    const m = {} as Record<PromptKey, string>
    for (const p of PROMPT_CATALOGO)
      m[p.key] = (template.prompts?.[p.key]?.trim() || p.default) as string
    return m
  })

  const onSalvar = (): void => {
    const prompts: Record<string, string> = {}
    for (const p of PROMPT_CATALOGO) {
      const t = (vals[p.key] ?? '').trim()
      if (t && t !== p.default) prompts[p.key] = t // só guarda overrides reais
    }
    salvar.mutate(
      { obra_id: obraId, prompts, versao: template.versao },
      { onSuccess: () => toast.success('Prompts salvos. Reprocesse para aplicar aos documentos.') }
    )
  }

  const algumModificado = PROMPT_CATALOGO.some((p) => (vals[p.key] ?? '').trim() !== p.default)

  return (
    <div className="p-5 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between sticky top-0 z-10 bg-bg pb-2">
        <p className="text-2xs text-text-dim flex items-center gap-1.5">
          <Info size={12} /> Vazio/igual ao padrão usa o prompt embutido. As partes técnicas (JSON,
          listas de campos) são sempre anexadas pelo sistema.
        </p>
        <Button
          onClick={onSalvar}
          disabled={salvar.isPending || !algumModificado}
          variant="default"
          size="sm"
        >
          <Save size={13} /> {salvar.isPending ? 'Salvando…' : 'Salvar prompts'}
        </Button>
      </div>

      {PROMPT_CATALOGO.map((p) => {
        const modificado = (vals[p.key] ?? '').trim() !== p.default
        return (
          <div key={p.key} className="rounded-lg border border-border bg-bg-panel p-4">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-text">{p.titulo}</h3>
              {modificado ? <Badge variant="accent">personalizado</Badge> : null}
              <button
                type="button"
                onClick={() => setVals((v) => ({ ...v, [p.key]: p.default }))}
                disabled={!modificado}
                className="ml-auto inline-flex items-center gap-1 text-2xs text-text-dim hover:text-text disabled:opacity-40"
                title="Restaurar o prompt padrão"
              >
                <RotateCcw size={11} /> Restaurar padrão
              </button>
            </div>
            <p className="text-2xs text-text-dim mb-2">{p.descricao}</p>
            {p.placeholders.length ? (
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <span className="text-[10px] text-text-dim">Placeholders (mantenha):</span>
                {p.placeholders.map((ph) => (
                  <code
                    key={ph}
                    className="text-[10px] font-mono rounded bg-bg-elevated border border-border px-1 py-0.5 text-accent"
                  >
                    {ph}
                  </code>
                ))}
              </div>
            ) : null}
            <textarea
              value={vals[p.key] ?? ''}
              onChange={(e) => setVals((v) => ({ ...v, [p.key]: e.target.value }))}
              rows={Math.min(14, Math.max(4, (vals[p.key] ?? '').split('\n').length + 1))}
              spellCheck={false}
              className="w-full rounded border border-border bg-bg px-2.5 py-2 text-xs text-text font-mono leading-relaxed resize-y focus:border-border-accent outline-none"
            />
            <p className="text-[10px] text-text-dim mt-1.5">
              <b>Anexado pelo sistema:</b> {p.anexadoPeloSistema}
            </p>
          </div>
        )
      })}
    </div>
  )
}

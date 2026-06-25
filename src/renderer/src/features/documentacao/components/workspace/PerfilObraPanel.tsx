import { type ReactNode } from 'react'
import { toast } from 'sonner'
import { Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NaturezaContrato, PerfilOrgao } from '@/types/documentacao'
import { useObraPerfil, useSalvarObraPerfil } from '@/features/documentacao/hooks/perfil'

const ORGAOS: PerfilOrgao[] = ['DNIT', 'GOINFRA', 'PREFEITURA', 'SANEAGO', 'PRIVADO']

/**
 * Peculiaridades da obra que adaptam os grupos do template (aplicavel_se):
 * consórcio, natureza (público/privado) e órgão. Determinístico — definido aqui,
 * usado já na classificação.
 */
export function PerfilObraPanel({ obraId }: { obraId: string }): ReactNode {
  const { data: perfil } = useObraPerfil(obraId)
  const salvar = useSalvarObraPerfil()

  const set = (
    patch: Partial<{ consorcio: boolean; natureza: NaturezaContrato; perfil_orgao: PerfilOrgao }>
  ): void => {
    salvar.mutate({ obra_id: obraId, ...patch }, { onError: (e) => toast.error(e.message) })
  }

  if (!perfil) return null

  return (
    <div className="rounded-lg border border-border bg-bg-panel px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <Building2 size={14} className="text-accent" />
        <span className="text-xs font-semibold text-text">Perfil da obra</span>
        <span className="text-2xs text-text-dim">
          adapta quais grupos se aplicam (consórcio, público/privado, órgão)
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-2xs">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={perfil.consorcio}
            onChange={(e) => set({ consorcio: e.target.checked })}
          />
          <span className={perfil.consorcio ? 'text-accent font-medium' : 'text-text-dim'}>
            Obra em consórcio
          </span>
        </label>

        <div className="flex items-center gap-1.5">
          <span className="text-text-dim">Natureza</span>
          {(['publico', 'privado'] as NaturezaContrato[]).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => set({ natureza: n })}
              className={cn(
                'rounded px-2 py-0.5 border',
                perfil.natureza === n
                  ? 'border-accent text-accent bg-accent/10'
                  : 'border-border text-text-dim hover:text-text'
              )}
            >
              {n === 'publico' ? 'público' : 'privado'}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5">
          <span className="text-text-dim">Órgão</span>
          <select
            value={perfil.perfil_orgao}
            onChange={(e) => set({ perfil_orgao: e.target.value as PerfilOrgao })}
            className="rounded border border-border bg-bg px-1.5 py-1 text-text"
          >
            {ORGAOS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}

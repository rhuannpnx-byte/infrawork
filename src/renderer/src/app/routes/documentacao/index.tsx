import { type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { FileText, FolderArchive, UploadCloud, ArrowRight, ShieldCheck } from 'lucide-react'
import { RequireRole } from '@/components/layout/RequireRole'
import { RequireObra } from '@/components/layout/RequireObra'
import { PageHeader } from '@/components/layout/PageHeader'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useContratos } from '@/features/documentacao/hooks/contratos'
import { useDocumentos } from '@/features/documentacao/hooks/documentos'
import { CATEGORIAS_ESSENCIAIS } from '@/types/documentacao'
import { cn } from '@/lib/utils'

export function DocumentacaoIndex(): ReactNode {
  return (
    <RequireRole allow={['god']} pageTitle="Documentação Oficial">
      <RequireObra pageTitle="Documentação Oficial">
        <Inner />
      </RequireObra>
    </RequireRole>
  )
}

function Inner(): ReactNode {
  const navigate = useNavigate()
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const { data: contratos = [] } = useContratos(obraId)
  const { data: documentos = [] } = useDocumentos(obraId)

  const presentes = new Set(documentos.map((d) => d.tipo_codigo))
  const essenciaisCobertas = CATEGORIAS_ESSENCIAIS.filter((c) => presentes.has(c)).length
  const lacunas = CATEGORIAS_ESSENCIAIS.length - essenciaisCobertas

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Documentação Oficial"
        subtitle={`${scope.obra?.nome ?? ''} — repositório definitivo dos documentos da obra.`}
      />
      <div className="flex-1 overflow-auto p-5 space-y-4">
        <div className="grid grid-cols-4 gap-3">
          <Card
            icon={<FileText size={16} />}
            label="Contratos"
            value={contratos.length.toString()}
            hint="da obra"
            onClick={() => navigate({ to: '/documentacao/contratos' })}
          />
          <Card
            icon={<FolderArchive size={16} />}
            label="Documentos"
            value={documentos.length.toString()}
            hint="ingeridos"
            onClick={() => navigate({ to: '/documentacao/repositorio' })}
          />
          <Card
            icon={<ShieldCheck size={16} />}
            label="Cobertura essencial"
            value={`${essenciaisCobertas}/${CATEGORIAS_ESSENCIAIS.length}`}
            hint={lacunas > 0 ? `${lacunas} lacuna(s)` : 'completa'}
            onClick={() => navigate({ to: '/documentacao/repositorio' })}
          />
          <Card
            icon={<UploadCloud size={16} />}
            label="Ingestão"
            value="+"
            hint="pasta / drag-drop"
            onClick={() => navigate({ to: '/documentacao/ingestao' })}
          />
        </div>

        <div className="rounded border border-border bg-bg-panel p-4">
          <h3 className="text-sm font-semibold text-text mb-2">Como funciona</h3>
          <p className="text-xs text-text-muted leading-relaxed">
            Cadastre o <strong>contrato</strong> da obra → ingira os documentos (de pastas locais,
            rede ou OneDrive sincronizado — arquivos “apenas online” são hidratados — ou
            arrastando-e-soltando) → classifique na taxonomia canônica de 20 categorias. Cada
            documento tem <strong>um nome visível</strong> e <strong>status descritivo</strong>; o
            histórico de versões fica por baixo. A guarda e a decisão seguem humanas.
          </p>
        </div>
      </div>
    </div>
  )
}

function Card({
  icon,
  label,
  value,
  hint,
  onClick
}: {
  icon: ReactNode
  label: string
  value: string
  hint?: string
  onClick: () => void
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group text-left rounded border border-border bg-bg-panel p-4 transition-colors',
        'hover:border-border-accent hover:bg-bg-hover'
      )}
    >
      <div className="flex items-center justify-between text-text-dim mb-2">
        <div className="flex items-center gap-2 text-2xs font-mono uppercase tracking-wider">
          {icon}
          {label}
        </div>
        <ArrowRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div className="text-2xl font-semibold text-text font-mono">{value}</div>
      {hint ? <div className="text-2xs text-text-muted font-mono mt-1">{hint}</div> : null}
    </button>
  )
}

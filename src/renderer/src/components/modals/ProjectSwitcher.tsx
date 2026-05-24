import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, Building2, Folder, Search, Star } from 'lucide-react'
import { Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/layout/EmptyState'
import { useAuthStore } from '@/stores/auth-store'
import { useObraStore } from '@/stores/obra-store'
import { useUIStore } from '@/stores/ui-store'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useEmpresas } from '@/features/gerencial/hooks'
import { cn } from '@/lib/utils'

type Step = 'empresa' | 'obra'

export function ProjectSwitcher(): ReactNode {
  const open = useUIStore((s) => s.activeModals.has('projectSwitcher'))
  const close = (): void => useUIStore.getState().closeModal('projectSwitcher')

  const profile = useAuthStore((s) => s.profile)
  const obras = useAuthStore((s) => s.obras)
  const scope = useCurrentScope()
  const setEmpresaId = useObraStore((s) => s.setEmpresaId)
  const setObraId = useObraStore((s) => s.setObraId)
  const { data: empresasList = [] } = useEmpresas()
  const empresaNomeById = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of empresasList) m.set(e.id, e.nome)
    return m
  }, [empresasList])

  // Para God começamos em "empresa" se não houver uma escolhida; senão, "obra".
  const initialStep: Step = scope.isGod && !scope.empresaId ? 'empresa' : 'obra'
  const [step, setStep] = useState<Step>(initialStep)
  const [query, setQuery] = useState('')

  // Sempre que o modal abre, reposiciona no passo inicial
  useEffect(() => {
    if (open) {
      setStep(initialStep)
      setQuery('')
    }
  }, [open, initialStep])

  // Lista única de empresas extraída das obras visíveis (God vê tudo via /me)
  const empresas = useMemo(() => {
    const map = new Map<string, string>()
    for (const o of obras) {
      // o.empresa_id existe; o nome da empresa NÃO vem em AuthObra. Usamos o
      // empresa_id como label fallback até carregarmos via `useEmpresas` em
      // outro lugar; aqui basta listar IDs distintos.
      if (!map.has(o.empresa_id)) map.set(o.empresa_id, o.empresa_id)
    }
    return Array.from(map.keys())
  }, [obras])

  const filteredObras = useMemo(() => {
    const q = query.toLowerCase().trim()
    const list = scope.obrasNaEmpresa
    if (!q) return list
    return list.filter(
      (o) => o.codigo.toLowerCase().includes(q) || o.nome.toLowerCase().includes(q)
    )
  }, [scope.obrasNaEmpresa, query])

  const empresaLabel = scope.empresaId
    ? empresaNomeById.get(scope.empresaId) ?? scope.empresaId.slice(0, 8)
    : ''

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} size="md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {step === 'obra' && scope.isGod && empresas.length > 1 ? (
            <button
              type="button"
              onClick={() => setStep('empresa')}
              className="text-text-dim hover:text-text"
              aria-label="Voltar para seleção de empresa"
            >
              <ArrowLeft size={13} />
            </button>
          ) : null}
          {step === 'empresa' ? 'Selecionar empresa' : 'Selecionar obra'}
          {step === 'obra' && scope.empresaId ? (
            <Badge variant="default" className="ml-1">
              <Building2 size={9} /> {empresaLabel}
            </Badge>
          ) : null}
        </DialogTitle>
      </DialogHeader>

      <DialogBody className="pt-0">
        <div className="relative mb-3">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-dim" />
          <Input
            placeholder={step === 'empresa' ? 'Buscar empresa…' : 'Buscar obra…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-7"
            autoFocus
          />
        </div>

        {step === 'empresa' ? (
          <EmpresasList
            empresaIds={empresas}
            currentId={scope.empresaId}
            obras={obras}
            query={query}
            nomeById={empresaNomeById}
            onSelect={(id) => {
              setEmpresaId(id)
              setStep('obra')
              setQuery('')
            }}
          />
        ) : (
          <ObrasList
            obras={filteredObras}
            currentId={scope.obraId}
            disabled={!scope.empresaId}
            onSelect={(id) => {
              setObraId(id)
              close()
            }}
            emptyVariant={
              scope.isGod && !scope.empresaId
                ? 'no-empresa'
                : profile?.role === 'engenheiro' || profile?.role === 'apoio'
                  ? 'no-access'
                  : 'no-obras'
            }
          />
        )}
      </DialogBody>

      <DialogFooter>
        <Button variant="ghost" onClick={close}>
          Fechar
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

interface EmpresasListProps {
  empresaIds: string[]
  currentId: string | null
  obras: Array<{ id: string; empresa_id: string; nome: string; codigo: string }>
  query: string
  nomeById: Map<string, string>
  onSelect: (id: string) => void
}

function EmpresasList({ empresaIds, currentId, obras, query, nomeById, onSelect }: EmpresasListProps): ReactNode {
  const items = useMemo(() => {
    const q = query.toLowerCase().trim()
    return empresaIds
      .map((id) => ({
        id,
        nome: nomeById.get(id) ?? id.slice(0, 8),
        obrasCount: obras.filter((o) => o.empresa_id === id).length
      }))
      .filter((it) => !q || it.nome.toLowerCase().includes(q) || it.id.toLowerCase().includes(q))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [empresaIds, obras, query, nomeById])

  if (items.length === 0) {
    return (
      <EmptyState
        icon="building-2"
        title="Nenhuma empresa visível"
        description="Cadastre uma empresa em Gerencial → Empresas e adicione obras a ela."
      />
    )
  }

  return (
    <div className="space-y-1 max-h-[320px] overflow-y-auto">
      {items.map((it) => {
        const isActive = it.id === currentId
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onSelect(it.id)}
            className={cn(
              'w-full text-left rounded border p-3 transition-colors flex items-center justify-between gap-3',
              isActive
                ? 'border-accent-line bg-accent-glow'
                : 'border-border bg-bg-elevated hover:bg-bg-hover hover:border-border-accent'
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              {isActive ? (
                <Star size={11} className="text-warn fill-warn shrink-0" />
              ) : (
                <Building2 size={11} className="text-text-muted shrink-0" />
              )}
              <span className="text-sm text-text font-medium truncate">{it.nome}</span>
            </div>
            <span className="text-2xs font-mono text-text-muted shrink-0">
              {it.obrasCount} {it.obrasCount === 1 ? 'obra' : 'obras'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

interface ObrasListProps {
  obras: Array<{ id: string; codigo: string; nome: string; status: string }>
  currentId: string | null
  disabled: boolean
  emptyVariant: 'no-empresa' | 'no-obras' | 'no-access'
  onSelect: (id: string) => void
}

function ObrasList({ obras, currentId, disabled, emptyVariant, onSelect }: ObrasListProps): ReactNode {
  if (disabled) {
    return (
      <EmptyState
        icon="building-2"
        title="Selecione uma empresa primeiro"
        description="A lista de obras será filtrada pela empresa escolhida."
      />
    )
  }
  if (obras.length === 0) {
    return (
      <EmptyState
        icon="folder-open"
        title="Nenhuma obra disponível"
        description={
          emptyVariant === 'no-access'
            ? 'Você ainda não tem acesso a nenhuma obra. Solicite ao Adm da empresa.'
            : 'Cadastre a primeira obra em Gerencial → Obras.'
        }
      />
    )
  }

  return (
    <div className="space-y-1 max-h-[320px] overflow-y-auto">
      {obras.map((o) => {
        const isActive = o.id === currentId
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onSelect(o.id)}
            className={cn(
              'w-full text-left rounded border p-3 transition-colors',
              isActive
                ? 'border-accent-line bg-accent-glow'
                : 'border-border bg-bg-elevated hover:bg-bg-hover hover:border-border-accent'
            )}
          >
            <div className="flex items-center gap-2 mb-1">
              {isActive ? <Star size={11} className="text-warn fill-warn" /> : <Folder size={11} className="text-text-muted" />}
              <span className="font-mono text-accent text-xs">{o.codigo}</span>
              <Badge>{o.status.replace('_', ' ')}</Badge>
            </div>
            <div className="text-sm text-text font-medium">{o.nome}</div>
          </button>
        )
      })}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Building2, Folder, Search, Check } from 'lucide-react'
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
import { rotuloStatusObra } from '@/features/gerencial/lib/status-obra'

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
  const busca = useRef<HTMLInputElement>(null)
  const lista = useRef<HTMLDivElement>(null)

  // Sempre que o modal abre, reposiciona no passo inicial
  useEffect(() => {
    if (open) {
      setStep(initialStep)
      setQuery('')
    }
  }, [open, initialStep])

  // Empresas selecionáveis: as ativas do cadastro (inclusive as que ainda não têm
  // obra) + as das obras visíveis (caso a lista de empresas não esteja liberada
  // para o papel). Antes vinha só das obras — empresa recém-criada não aparecia.
  const empresas = useMemo(() => {
    const ids = new Set<string>()
    for (const e of empresasList) if (e.ativo) ids.add(e.id)
    for (const o of obras) ids.add(o.empresa_id)
    return Array.from(ids)
  }, [empresasList, obras])

  const filteredObras = useMemo(() => {
    const q = query.toLowerCase().trim()
    const list = scope.obrasNaEmpresa
    if (!q) return list
    return list.filter(
      (o) => o.codigo.toLowerCase().includes(q) || o.nome.toLowerCase().includes(q)
    )
  }, [scope.obrasNaEmpresa, query])

  const empresaLabel = scope.empresaId
    ? (empresaNomeById.get(scope.empresaId) ?? scope.empresaId.slice(0, 8))
    : ''

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} size="md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {step === 'obra' && scope.isGod && empresas.length > 1 ? (
            <button
              type="button"
              onClick={() => setStep('empresa')}
              className="inline-flex size-7 items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-text"
              aria-label="Voltar para a escolha da empresa"
              title="Voltar para a escolha da empresa"
            >
              <ArrowLeft size={14} />
            </button>
          ) : null}
          {step === 'empresa' ? 'Escolher a empresa' : 'Escolher a obra'}
          {step === 'obra' && scope.empresaId ? (
            <Badge variant="default" className="ml-1">
              <Building2 size={12} /> {empresaLabel}
            </Badge>
          ) : null}
        </DialogTitle>
      </DialogHeader>

      <DialogBody className="pt-0">
        <div className="relative mb-3">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-dim" />
          <Input
            placeholder={
              step === 'empresa' ? 'Buscar empresa' : 'Buscar obra pelo código ou pelo nome'
            }
            ref={busca}
            aria-label={step === 'empresa' ? 'Buscar empresa' : 'Buscar obra'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              const itens = lista.current?.querySelectorAll<HTMLElement>('button') ?? []
              if (e.key === 'ArrowDown' && itens.length) {
                e.preventDefault()
                itens[0].focus()
              } else if (e.key === 'Enter' && itens.length === 1) {
                e.preventDefault()
                itens[0].click()
              }
            }}
            className="pl-7"
            autoFocus
          />
        </div>

        <div
          ref={lista}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            const itens = [...(lista.current?.querySelectorAll<HTMLElement>('button') ?? [])]
            const i = itens.indexOf(document.activeElement as HTMLElement)
            if (i < 0) return
            e.preventDefault()
            const alvo = itens[i + (e.key === 'ArrowDown' ? 1 : -1)]
            if (alvo) alvo.focus()
            else if (e.key === 'ArrowUp') busca.current?.focus()
          }}
        >
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
              buscando={!!query.trim()}
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
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={close}>
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

function EmpresasList({
  empresaIds,
  currentId,
  obras,
  query,
  nomeById,
  onSelect
}: EmpresasListProps): ReactNode {
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
    return query.trim() ? (
      <EmptyState
        icon="building-2"
        title="Nenhuma empresa com esse nome"
        description="Confira a grafia ou apague a busca para ver todas."
      />
    ) : (
      <EmptyState
        icon="building-2"
        title="Nenhuma empresa visível"
        description="Cadastre uma empresa em Gerencial, Empresas, e adicione obras a ela."
      />
    )
  }

  return (
    <div className="space-y-1 max-h-[min(360px,50vh)] overflow-y-auto">
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
                ? 'border-accent bg-accent-glow-strong'
                : 'border-border bg-bg-panel hover:bg-bg-hover hover:border-border-accent'
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              {isActive ? (
                <Check size={14} className="text-accent shrink-0" />
              ) : (
                <Building2 size={12} className="text-text-muted shrink-0" />
              )}
              <span className="text-sm text-text font-medium truncate">{it.nome}</span>
            </div>
            <span className="text-xs tabular text-text-muted shrink-0">
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
  /** Há texto na busca: o vazio é da busca, não do cadastro. */
  buscando: boolean
  emptyVariant: 'no-empresa' | 'no-obras' | 'no-access'
  onSelect: (id: string) => void
}

function ObrasList({
  obras,
  currentId,
  disabled,
  buscando,
  emptyVariant,
  onSelect
}: ObrasListProps): ReactNode {
  if (disabled) {
    return (
      <EmptyState
        icon="building-2"
        title="Escolha a empresa primeiro"
        description="A lista mostra as obras da empresa escolhida."
      />
    )
  }
  if (obras.length === 0 && buscando) {
    return (
      <EmptyState
        icon="folder-open"
        title="Nenhuma obra com esse código ou nome"
        description="Confira a grafia ou apague a busca para ver todas."
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
            ? 'Você ainda não tem acesso a nenhuma obra. Peça ao administrador da empresa.'
            : 'Cadastre a primeira obra em Gerencial, Obras.'
        }
      />
    )
  }

  return (
    <div className="space-y-1 max-h-[min(360px,50vh)] overflow-y-auto">
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
                ? 'border-accent bg-accent-glow-strong'
                : 'border-border bg-bg-panel hover:bg-bg-hover hover:border-border-accent'
            )}
          >
            <div className="flex items-center gap-2 mb-1">
              {isActive ? (
                <Check size={14} className="text-accent" />
              ) : (
                <Folder size={12} className="text-text-muted" />
              )}
              <span className="tabular font-semibold text-accent text-sm">{o.codigo}</span>
              <Badge variant="outline">{rotuloStatusObra(o.status)}</Badge>
            </div>
            <div className="text-sm text-text font-medium">{o.nome}</div>
          </button>
        )
      })}
    </div>
  )
}

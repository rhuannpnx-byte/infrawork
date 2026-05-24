import { type ReactNode } from 'react'
import { Check, Star, ChevronDown, LogOut, User, Building2, Folder } from 'lucide-react'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from '@/components/ui/dropdown'
import { cn } from '@/lib/utils'

const MENU_ITEMS = ['Arquivo', 'Editar', 'Exibir', 'Inserir', 'Ferramentas', 'Ajuda']

export function MenuBar(): ReactNode {
  return (
    <div
      style={{ gridArea: 'menu' }}
      className="bg-bg-menu border-b border-border flex items-center px-2 text-xs"
    >
      {/* Left: menus */}
      <div className="flex items-center gap-px">
        {MENU_ITEMS.map((m) => (
          <button
            key={m}
            type="button"
            className="h-6 px-2 rounded-sm text-text-muted hover:text-text hover:bg-bg-hover"
          >
            {m}
          </button>
        ))}
      </div>

      {/* Center: saved + scope pill */}
      <div className="flex-1 flex items-center justify-center gap-3">
        <div className="flex items-center gap-1 text-2xs text-text-muted">
          <Check size={11} className="text-success" strokeWidth={2.5} />
          Salvo
        </div>
        <ScopePill />
      </div>

      {/* Right: version + user menu */}
      <div className="flex items-center gap-3 text-2xs font-mono text-text-dim">
        <span title="Versão do app">v{__APP_VERSION__}</span>
        <UserMenu />
      </div>
    </div>
  )
}

function ScopePill(): ReactNode {
  const openModal = useUIStore((s) => s.openModal)
  const empresa = useAuthStore((s) => s.empresa) // empresa do profile (Adm/Eng/Apoio)
  const scope = useCurrentScope()

  // Texto que aparece na pill
  const empresaLabel = empresa
    ? empresa.nome
    : scope.empresaId
      ? scope.empresaId.slice(0, 8) + '…'
      : null

  const obraLabel = scope.obra ? `${scope.obra.codigo}` : null
  const obraNome = scope.obra?.nome

  // Estilo: dourado quando há obra ativa, neutro quando falta seleção
  const ativo = !!scope.obra
  const incompleto = scope.precisaSelecionarEmpresa || scope.precisaSelecionarObra

  return (
    <button
      type="button"
      onClick={() => openModal('projectSwitcher')}
      className={cn(
        'h-6 px-2 rounded border flex items-center gap-1.5 max-w-[480px]',
        ativo
          ? 'border-border-strong bg-bg-elevated hover:border-border-accent'
          : 'border-warn/40 bg-warn/5 hover:border-warn'
      )}
      title="Trocar empresa / obra"
    >
      {ativo ? (
        <Star size={11} className="text-warn fill-warn shrink-0" />
      ) : (
        <Building2 size={11} className={incompleto ? 'text-warn' : 'text-text-dim'} />
      )}

      {empresaLabel ? (
        <span className="text-text-muted truncate max-w-[180px]">{empresaLabel}</span>
      ) : (
        <span className={incompleto ? 'text-warn' : 'text-text-dim'}>
          {scope.isGod ? 'Selecionar empresa' : 'Sem empresa'}
        </span>
      )}

      {empresaLabel ? (
        <>
          <span className="text-text-dim">·</span>
          {obraLabel ? (
            <>
              <Folder size={10} className="text-text-muted shrink-0" />
              <span className="font-mono text-accent">{obraLabel}</span>
              {obraNome ? (
                <span className="text-text-muted truncate max-w-[180px] hidden sm:inline">
                  {obraNome}
                </span>
              ) : null}
            </>
          ) : (
            <span className={cn('text-2xs font-mono', incompleto ? 'text-warn' : 'text-text-dim')}>
              {incompleto ? 'selecionar obra' : 'sem obra'}
            </span>
          )}
        </>
      ) : null}

      <ChevronDown size={11} className="text-text-dim shrink-0" />
    </button>
  )
}

function UserMenu(): ReactNode {
  const profile = useAuthStore((s) => s.profile)
  const empresa = useAuthStore((s) => s.empresa)
  const signOut = useAuthStore((s) => s.signOut)

  if (!profile) return null

  const initials = profile.nome
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <Dropdown
      align="end"
      trigger={
        <button
          type="button"
          className="h-6 px-1.5 rounded border border-border-strong bg-bg-elevated hover:border-border-accent flex items-center gap-1.5 text-text"
          aria-label="Menu do usuário"
        >
          <span className="w-4 h-4 rounded-full bg-accent text-bg flex items-center justify-center text-[8px] font-bold uppercase">
            {initials || <User size={9} />}
          </span>
          <span className="text-text-muted">{profile.role}</span>
          <ChevronDown size={10} className="text-text-dim" />
        </button>
      }
    >
      <DropdownLabel>{profile.nome}</DropdownLabel>
      <div className="px-2 pb-1 text-2xs font-mono text-text-dim truncate max-w-[220px]">
        {profile.email}
      </div>
      <div className="px-2 pb-1 text-2xs font-mono text-text-muted">
        {empresa ? empresa.nome : 'Acesso global'}
      </div>
      <DropdownSeparator />
      <DropdownItem variant="danger" onClick={() => void signOut()}>
        <LogOut size={11} /> Sair
      </DropdownItem>
    </Dropdown>
  )
}

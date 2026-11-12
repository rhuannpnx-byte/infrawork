import { useState, type ReactNode } from 'react'
import {
  Search,
  ChevronDown,
  LogOut,
  User,
  Building2,
  Bot,
  PanelLeft,
  Sun,
  Moon,
  Monitor,
  Check
} from 'lucide-react'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { useThemeStore, type TemaPreferencia } from '@/stores/theme-store'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useEmpresas } from '@/features/gerencial/hooks'
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from '@/components/ui/dropdown'
import { IconButton } from '@/components/ui/IconButton'
import { navigateActiveTab } from '@/app/navigateActiveTab'
import { cn } from '@/lib/utils'
import infraworkIcon from '@/assets/infrawork-icon.png'
import { PontoEstado, TokensIADialog } from '@/features/gerencial/modals/TokensIADialog'
import { useStatusMcp } from '@/features/gerencial/hooks/mcp'

/** Barra superior: menu, marca, obra em uso, busca, tema e usuário. */
export function TitleBar(): ReactNode {
  const openModal = useUIStore((s) => s.openModal)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)

  return (
    <header
      style={{ gridArea: 'title' }}
      className="bg-bg-menu border-b border-border flex items-center gap-2 px-2 min-w-0"
    >
      <IconButton
        aria-label="Mostrar ou ocultar o menu"
        title="Menu (Ctrl B)"
        onClick={toggleSidebar}
      >
        <PanelLeft size={16} strokeWidth={1.8} />
      </IconButton>
      <button
        type="button"
        onClick={() => navigateActiveTab('/')}
        className="flex items-center gap-1.5 pr-2 shrink-0 rounded"
        title="Início"
      >
        <img src={infraworkIcon} alt="" className="h-7 w-7 select-none" draggable={false} />
        <span className="hidden md:inline text-xl font-bold tracking-tight text-text">
          InfraWork
        </span>
      </button>

      <ScopePill />

      <button
        type="button"
        onClick={() => openModal('commandPalette')}
        className="hidden sm:flex items-center gap-2 flex-1 max-w-[420px] min-w-[140px] h-8 px-2.5 rounded bg-bg border border-border text-sm text-text-dim hover:border-border-strong"
      >
        <Search size={13} className="shrink-0" />
        <span className="flex-1 text-left truncate">Buscar páginas, obras e ações</span>
        <span className="font-mono text-2xs px-1.5 border border-border-strong rounded">
          Ctrl K
        </span>
      </button>

      <div className="flex-1 min-w-0" />

      <BotaoTema />
      <UserMenu />
    </header>
  )
}

const TEMAS: { valor: TemaPreferencia; rotulo: string; icone: ReactNode }[] = [
  { valor: 'light', rotulo: 'Claro', icone: <Sun size={12} /> },
  { valor: 'dark', rotulo: 'Escuro', icone: <Moon size={12} /> },
  { valor: 'system', rotulo: 'Seguir o sistema', icone: <Monitor size={12} /> }
]

function BotaoTema(): ReactNode {
  const tema = useThemeStore((s) => s.tema)
  const setPreferencia = useThemeStore((s) => s.setPreferencia)
  const proximo = tema === 'dark' ? 'light' : 'dark'
  return (
    <IconButton
      aria-label={proximo === 'dark' ? 'Usar o tema escuro' : 'Usar o tema claro'}
      title={proximo === 'dark' ? 'Tema escuro' : 'Tema claro'}
      onClick={() => setPreferencia(proximo)}
    >
      {tema === 'dark' ? <Sun size={15} strokeWidth={1.8} /> : <Moon size={15} strokeWidth={1.8} />}
    </IconButton>
  )
}

export function ScopePill(): ReactNode {
  const openModal = useUIStore((s) => s.openModal)
  const empresa = useAuthStore((s) => s.empresa) // empresa do profile (Adm/Eng/Apoio)
  const scope = useCurrentScope()
  // God não tem `empresa` no profile — busca pelo id no catálogo
  const { data: empresasList = [] } = useEmpresas()
  const empresaSelecionada =
    empresa ??
    (scope.empresaId ? (empresasList.find((e) => e.id === scope.empresaId) ?? null) : null)

  const empresaLabel = empresaSelecionada?.nome ?? null
  const incompleto = scope.precisaSelecionarEmpresa || scope.precisaSelecionarObra

  return (
    <button
      type="button"
      onClick={() => openModal('projectSwitcher')}
      className={cn(
        'h-8 px-2.5 rounded border flex items-center gap-2 min-w-0 max-w-[460px] text-sm',
        scope.obra
          ? 'border-border-strong bg-bg-panel hover:border-border-accent'
          : 'border-warn/50 bg-warn/10 hover:border-warn'
      )}
      title={empresaLabel ? `${empresaLabel}: trocar empresa ou obra` : 'Trocar empresa ou obra'}
    >
      {scope.obra ? (
        <>
          <span className="font-mono font-semibold text-accent shrink-0">{scope.obra.codigo}</span>
          <span className="text-text truncate hidden sm:inline">{scope.obra.nome}</span>
        </>
      ) : (
        <>
          <Building2 size={13} className="text-warn shrink-0" />
          <span className={cn('truncate', incompleto ? 'text-warn' : 'text-text-muted')}>
            {empresaLabel
              ? incompleto
                ? 'Selecionar obra'
                : 'Sem obra'
              : scope.isGod
                ? 'Selecionar empresa'
                : 'Sem empresa'}
          </span>
        </>
      )}
      <ChevronDown size={12} className="text-text-dim shrink-0" />
    </button>
  )
}

export function UserMenu(): ReactNode {
  const profile = useAuthStore((s) => s.profile)
  const empresa = useAuthStore((s) => s.empresa)
  const signOut = useAuthStore((s) => s.signOut)
  const [tokensAberto, setTokensAberto] = useState(false)
  const preferencia = useThemeStore((s) => s.preferencia)
  const setPreferencia = useThemeStore((s) => s.setPreferencia)

  if (!profile) return null

  const initials = profile.nome
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <>
      <Dropdown
        align="end"
        trigger={
          <button
            type="button"
            className="h-8 pl-1 pr-1.5 rounded hover:bg-bg-hover flex items-center gap-1.5 text-text"
            aria-label="Menu do usuário"
          >
            <span className="w-6 h-6 rounded-full bg-accent text-[color:var(--on-accent)] flex items-center justify-center text-2xs font-semibold uppercase">
              {initials || <User size={12} />}
            </span>
            <ChevronDown size={12} className="text-text-dim" />
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
        <DropdownLabel>Tema</DropdownLabel>
        {TEMAS.map((t) => (
          <DropdownItem key={t.valor} onClick={() => setPreferencia(t.valor)}>
            {t.icone} {t.rotulo}
            {preferencia === t.valor ? <Check size={12} className="text-accent" /> : null}
          </DropdownItem>
        ))}
        <DropdownSeparator />
        <DropdownLabel>IA (MCP)</DropdownLabel>
        <StatusMcpMenu />
        <DropdownItem onClick={() => setTokensAberto(true)}>
          <Bot size={11} /> Conectar IA, tokens e status…
        </DropdownItem>
        <DropdownSeparator />
        <DropdownItem variant="danger" onClick={() => void signOut()}>
          <LogOut size={11} /> Sair
        </DropdownItem>
      </Dropdown>
      <TokensIADialog open={tokensAberto} onOpenChange={setTokensAberto} />
    </>
  )
}

/** Linha de status do MCP no menu do usuário (só consulta quando o menu abre). */
function StatusMcpMenu(): ReactNode {
  const { status } = useStatusMcp()
  const servidor =
    status.servidor === 'ok' ? 'no ar' : status.servidor === 'off' ? 'fora do ar' : '…'
  const oauth =
    status.oauth === 'ok' ? 'login ligado' : status.oauth === 'off' ? 'login desligado' : '…'
  return (
    <div
      className="px-2 pb-1.5 space-y-0.5 text-2xs font-mono text-text-muted"
      data-testid="menu-mcp-status"
    >
      <div className="flex items-center gap-1.5">
        <PontoEstado estado={status.servidor} /> servidor {servidor}
      </div>
      <div className="flex items-center gap-1.5">
        <PontoEstado estado={status.oauth} /> {oauth}
      </div>
      <div className="flex items-center gap-1.5">
        <PontoEstado estado={status.ativos.length > 0 ? 'ok' : 'off'} /> {status.ativos.length}{' '}
        token(s) ativo(s)
      </div>
    </div>
  )
}

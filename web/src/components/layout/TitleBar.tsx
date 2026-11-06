import { useState, type ReactNode } from 'react'
import { Search, Star, ChevronDown, LogOut, User, Building2, Folder, Bot } from 'lucide-react'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useEmpresas } from '@/features/gerencial/hooks'
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from '@/components/ui/dropdown'
import { cn } from '@/lib/utils'
import infraworkIcon from '@/assets/infrawork-icon.png'
import { PontoEstado, TokensIADialog } from '@/features/gerencial/modals/TokensIADialog'
import { useStatusMcp } from '@/features/gerencial/hooks/mcp'

/**
 * Barra de título (estilo VSCode), unificando marca, busca, seletor de
 * escopo e menu do usuário numa única faixa.
 */
export function TitleBar(): ReactNode {
  const openModal = useUIStore((s) => s.openModal)

  return (
    <div
      style={{ gridArea: 'title' }}
      className="relative bg-bg-tabs border-b border-border flex items-center gap-2 pl-2 pr-2 text-xs"
    >
      {/* Brand */}
      <div className="flex items-center shrink-0" title="InfraWork">
        <img
          src={infraworkIcon}
          alt="InfraWork"
          className="h-8 w-8 select-none"
          draggable={false}
        />
      </div>

      {/* Busca */}
      <button
        type="button"
        onClick={() => openModal('commandPalette')}
        className="flex items-center gap-1.5 w-[180px] h-6 px-2 rounded bg-bg-elevated border border-border-strong text-2xs text-text-dim hover:border-border-accent shrink-0"
      >
        <Search size={11} />
        <span className="flex-1 text-left">Buscar ou comando…</span>
        <span className="font-mono text-text-faint">Ctrl K</span>
      </button>

      {/* Área central */}
      <div className="flex-1 min-w-0" />

      {/* Seletor de empresa/obra — centralizado horizontalmente na barra */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <ScopePill />
      </div>

      {/* Cluster direito */}
      <div className="flex items-center gap-3 shrink-0 pl-1">
        <span className="text-2xs font-mono text-text-dim" title="Versão do app">
          v{__APP_VERSION__}
        </span>
        <UserMenu />
      </div>
    </div>
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

export function UserMenu(): ReactNode {
  const profile = useAuthStore((s) => s.profile)
  const empresa = useAuthStore((s) => s.empresa)
  const signOut = useAuthStore((s) => s.signOut)
  const [tokensAberto, setTokensAberto] = useState(false)

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

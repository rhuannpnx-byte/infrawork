import { type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { Icon } from '@/components/layout/IconRenderer'
import { MODULES } from '@/config/modules'
import { useAuthStore } from '@/stores/auth-store'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { visibleFor } from '@/types/module'
import infraworkWordmark from '@/assets/infrawork-wordmark.png'
import { cn } from '@/lib/utils'

interface ModuleSummary {
  key: string
  title: string
  tagline: string
  description: string
  highlights: string[]
}

const SUMMARIES: Record<string, ModuleSummary> = {
  orcamento: {
    key: 'orcamento',
    title: 'Orçamento',
    tagline: 'Composição de custos por obra',
    description:
      'Recursos, CPUs e planilha 100% vedados por obra, com revisões versionadas e indireto integrado.',
    highlights: ['Planilha', 'CPUs', 'Revisões', 'Lucratividade']
  },
  planejamento: {
    key: 'planejamento',
    title: 'Planejamento',
    tagline: 'Cronograma físico e curva-S',
    description:
      'Distribui no tempo os serviços do orçamento, aloca equipes e gera curva-S baseline imutável.',
    highlights: ['Gantt', 'Equipes', 'Curva-S', 'Baseline']
  },
  acompanhamento: {
    key: 'acompanhamento',
    title: 'Acompanhamento',
    tagline: 'Realizado em obra · integração SIGA',
    description:
      'Produção e fotos sincronizadas do SIGA, com dashboard, previsto×realizado e alertas de desvio.',
    highlights: ['Dashboard', 'Prev × Real', 'Fotos & Mapa', 'Alertas']
  },
  gerencial: {
    key: 'gerencial',
    title: 'Gerencial',
    tagline: 'Administração do sistema',
    description:
      'Empresas, usuários e obras com controle granular de permissões por papel e por obra.',
    highlights: ['Empresas', 'Usuários', 'Obras', 'Permissões']
  }
}

export function HomePage(): ReactNode {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const empresa = useAuthStore((s) => s.empresa)
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const { obra } = useCurrentScope()

  const visibleModules = visibleFor(MODULES, role)
  const ordered = ['orcamento', 'planejamento', 'acompanhamento', 'gerencial']
    .map((k) => visibleModules.find((m) => m.key === k))
    .filter((m): m is (typeof MODULES)[number] => !!m)

  const primeiroNome = profile?.nome?.split(' ')[0] ?? ''
  const saudacao = greetingByHour()

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[440px] opacity-70"
        style={{
          background:
            'radial-gradient(ellipse 60% 80% at 50% 0%, rgba(56,139,253,0.20), transparent 60%)'
        }}
      />

      <div className="relative h-full max-w-5xl mx-auto px-6 py-6 flex flex-col gap-5">
        {/* Hero */}
        <section className="flex flex-col items-center text-center shrink-0">
          <img
            src={infraworkWordmark}
            alt="InfraWork"
            className="h-28 w-auto select-none drop-shadow-[0_0_36px_rgba(56,139,253,0.4)]"
            draggable={false}
          />
          <div className="mt-2 text-2xs font-mono uppercase tracking-[0.32em] text-text-dim">
            Engenharia · Planejamento · Acompanhamento
          </div>

          <h1 className="mt-5 text-2xl font-semibold text-text">
            {saudacao}
            {primeiroNome ? `, ${primeiroNome}` : ''}.
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-text-muted leading-snug">
            Plataforma integrada de gestão de obras de infraestrutura — do custo planejado ao
            realizado em campo.
          </p>

          <div className="mt-4 flex items-center gap-1.5 text-2xs font-mono">
            {empresa ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border bg-bg-panel text-text-dim">
                <Icon name="building-2" size={10} />
                {empresa.nome}
              </span>
            ) : null}
            {obra ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border bg-bg-panel text-text-dim">
                <Icon name="folder" size={10} />
                {obra.nome}
              </span>
            ) : null}
            {profile?.role ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-accent-line bg-accent-glow text-accent">
                <Icon name="shield" size={10} />
                {labelRole(profile.role)}
              </span>
            ) : null}
          </div>
        </section>

        {/* Cards de módulos */}
        <section className="shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xs font-mono uppercase tracking-wider text-text-dim">
              Módulos
            </span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {ordered.map((mod) => {
              const summary = SUMMARIES[mod.key]
              if (!summary) return null
              return (
                <button
                  key={mod.key}
                  type="button"
                  onClick={() => navigate({ to: mod.routePrefix })}
                  className={cn(
                    'group relative text-left rounded-md border border-border bg-bg-panel px-3 py-2.5',
                    'transition-all hover:border-border-accent hover:bg-bg-hover',
                    'shadow-sm hover:shadow-lg'
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <div className="w-8 h-8 rounded-md bg-accent-glow border border-accent-line flex items-center justify-center text-accent shrink-0">
                      <Icon name={mod.icon} size={15} strokeWidth={1.8} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-text leading-tight">{summary.title}</h3>
                        <ArrowRight
                          size={13}
                          className="text-text-dim group-hover:text-accent group-hover:translate-x-1 transition-all shrink-0"
                        />
                      </div>
                      <div className="text-2xs font-mono uppercase tracking-wider text-text-dim mt-0.5 truncate">
                        {summary.tagline}
                      </div>
                      <p className="text-2xs text-text-muted leading-snug mt-1.5">
                        {summary.description}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {summary.highlights.map((h) => (
                          <span
                            key={h}
                            className="inline-flex items-center px-1.5 py-0 rounded-sm text-2xs font-mono text-text-dim bg-bg-elevated border border-border"
                          >
                            {h}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        <footer className="mt-auto pt-2 border-t border-border text-2xs font-mono text-text-dim text-center shrink-0">
          InfraWork · v0.1.0
        </footer>
      </div>
    </div>
  )
}

function greetingByHour(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

function labelRole(r: string): string {
  switch (r) {
    case 'god':
      return 'God'
    case 'adm':
      return 'Administrador'
    case 'engenheiro':
      return 'Engenheiro'
    case 'apoio':
      return 'Apoio'
    default:
      return r
  }
}

import type { ModuleConfig } from '@/types/module'

/**
 * Catálogo de módulos do app. Cada item alimenta o PrimaryRail, a
 * SecondarySidebar e o CommandPalette. Apenas o módulo "Gerencial" está
 * ativo agora — os módulos operacionais (Orçamento, Planejamento etc.)
 * serão reintroduzidos aqui à medida que cada feature for implementada.
 */
export const MODULES: ModuleConfig[] = [
  {
    key: 'gerencial',
    title: 'Gerencial',
    icon: 'shield',
    shortcut: 'g g',
    routePrefix: '/gerencial',
    color: 'var(--accent)',
    category: 'system',
    requiredRoles: ['god', 'adm', 'engenheiro'],
    pills: [
      {
        icon: 'building-2',
        label: 'Empresas',
        route: '/gerencial/empresas',
        requiredRoles: ['god']
      },
      { icon: 'users', label: 'Usuários', route: '/gerencial/usuarios' },
      { icon: 'folder', label: 'Obras', route: '/gerencial/obras', requiredRoles: ['god', 'adm'] }
    ],
    sections: [
      {
        title: 'CADASTROS',
        items: [
          {
            icon: 'building-2',
            label: 'Empresas',
            route: '/gerencial/empresas',
            requiredRoles: ['god']
          },
          { icon: 'users', label: 'Usuários', route: '/gerencial/usuarios' },
          {
            icon: 'folder',
            label: 'Obras',
            route: '/gerencial/obras',
            requiredRoles: ['god', 'adm']
          }
        ]
      },
      {
        title: 'ACESSO',
        requiredRoles: ['god', 'adm'],
        items: [
          {
            icon: 'key-round',
            label: 'Permissões de obras',
            route: '/gerencial/obras',
            requiredRoles: ['god', 'adm']
          }
        ]
      }
    ]
  },
  {
    key: 'orcamento',
    title: 'Orçamento',
    icon: 'calculator',
    shortcut: 'g o',
    routePrefix: '/orcamento',
    color: 'var(--accent)',
    category: 'engineering',
    requiredRoles: ['god', 'adm', 'engenheiro', 'apoio'],
    pills: [],
    sections: [
      {
        title: 'OBRA',
        items: [
          {
            icon: 'layout-dashboard',
            label: 'Visão geral',
            route: '/orcamento/obra',
            requiresObra: true
          },
          {
            icon: 'list-tree',
            label: 'Planilha Orçamentária',
            route: '/orcamento/obra/plan-orc',
            requiresObra: true
          },
          {
            icon: 'briefcase',
            label: 'Indireto',
            route: '/orcamento/obra/indireto',
            requiresObra: true
          },
          {
            icon: 'trending-up',
            label: 'Lucratividade',
            route: '/orcamento/obra/lucratividade',
            requiresObra: true
          },
          {
            icon: 'history',
            label: 'Revisões',
            route: '/orcamento/obra/revisoes',
            requiresObra: true
          }
        ]
      },
      {
        title: 'CATÁLOGOS DA OBRA',
        items: [
          {
            icon: 'package',
            label: 'Recursos',
            route: '/orcamento/recursos',
            requiresObra: true
          },
          {
            icon: 'list-tree',
            label: 'Serviços',
            route: '/orcamento/servicos',
            requiresObra: true
          },
          {
            icon: 'calculator',
            label: 'CPUs',
            route: '/orcamento/cpus',
            requiresObra: true
          },
          {
            icon: 'percent',
            label: 'Taxas',
            route: '/orcamento/taxas',
            requiresObra: true,
            requiredRoles: ['god', 'adm', 'engenheiro']
          }
        ]
      }
    ]
  },
  {
    key: 'planejamento',
    title: 'Planejamento',
    icon: 'calendar',
    shortcut: 'g p',
    routePrefix: '/planejamento',
    color: 'var(--accent)',
    category: 'engineering',
    requiredRoles: ['god', 'adm', 'engenheiro', 'apoio'],
    pills: [],
    sections: [
      {
        title: 'GERAL',
        items: [
          {
            icon: 'layout-dashboard',
            label: 'Visão geral',
            route: '/planejamento',
            requiresObra: true
          },
          {
            icon: 'gantt-chart',
            label: 'Cronograma',
            route: '/planejamento/cronograma',
            requiresObra: true
          }
        ]
      },
      {
        title: 'CONFIG',
        items: [
          {
            icon: 'calendar-days',
            label: 'Calendário',
            route: '/planejamento/calendario',
            requiresObra: true
          },
          {
            icon: 'route',
            label: 'Trechos',
            route: '/planejamento/trechos',
            requiresObra: true
          },
          {
            icon: 'users',
            label: 'Equipes',
            route: '/planejamento/equipes',
            requiresObra: true
          }
        ]
      },
      {
        title: 'ANÁLISE',
        items: [
          {
            icon: 'trending-up',
            label: 'Curva-S',
            route: '/planejamento/curva-s',
            requiresObra: true
          },
          {
            icon: 'git-compare',
            label: 'Comparar baseline',
            route: '/planejamento/comparar',
            requiresObra: true
          },
          {
            icon: 'route',
            label: 'Marcha-Tempo',
            route: '/planejamento/marcha-tempo',
            requiresObra: true
          }
        ]
      },
      {
        title: 'REVISÕES',
        items: [
          {
            icon: 'history',
            label: 'Revisões',
            route: '/planejamento/revisoes',
            requiresObra: true
          }
        ]
      }
    ]
  },
  {
    key: 'acompanhamento',
    title: 'Acompanhamento',
    icon: 'activity',
    shortcut: 'g a',
    routePrefix: '/acompanhamento',
    color: 'var(--accent)',
    category: 'engineering',
    requiredRoles: ['god', 'adm', 'engenheiro', 'apoio', 'cliente'],
    pills: [],
    sections: [
      {
        title: 'OBRA',
        items: [
          // Itens SEM requiredRoles são visíveis ao Cliente (Calendário, Produção,
          // Fotos & Mapa, Previsto × Realizado). Os demais excluem 'cliente'
          // explicitamente — ambiente do cliente é só acompanhamento da obra.
          {
            icon: 'calendar-days',
            label: 'Calendário',
            route: '/acompanhamento/calendario',
            requiresObra: true
          },
          {
            icon: 'gauge',
            label: 'Dashboard',
            route: '/acompanhamento',
            requiresObra: true,
            requiredRoles: ['god', 'adm', 'engenheiro', 'apoio']
          },
          {
            icon: 'trending-up',
            label: 'Valor Agregado',
            route: '/acompanhamento/valor-agregado',
            requiresObra: true,
            requiredRoles: ['god', 'adm', 'engenheiro', 'apoio']
          },
          {
            icon: 'list-checks',
            label: 'Produção',
            route: '/acompanhamento/producao',
            requiresObra: true
          },
          {
            icon: 'map-pin',
            label: 'Fotos & Mapa',
            route: '/acompanhamento/fotos',
            requiresObra: true
          },
          {
            icon: 'users',
            label: 'Equipes',
            route: '/acompanhamento/equipes',
            requiresObra: true,
            requiredRoles: ['god', 'adm', 'engenheiro', 'apoio']
          },
          {
            icon: 'scale',
            label: 'Previsto × Realizado',
            route: '/acompanhamento/comparativo',
            requiresObra: true
          },
          {
            icon: 'alert-triangle',
            label: 'Alertas',
            route: '/acompanhamento/alertas',
            requiresObra: true,
            requiredRoles: ['god', 'adm', 'engenheiro', 'apoio']
          }
        ]
      },
      {
        title: 'ADMINISTRAÇÃO',
        requiredRoles: ['god', 'adm'],
        items: [
          {
            icon: 'link',
            label: 'Vínculo SIGA',
            route: '/acompanhamento/vincular',
            requiresObra: true,
            requiredRoles: ['god', 'adm']
          }
        ]
      }
    ]
  }
]

export function getModuleByRoute(pathname: string): ModuleConfig | undefined {
  return MODULES.find((m) => pathname.startsWith(m.routePrefix))
}

export function getModuleByKey(key: string): ModuleConfig | undefined {
  return MODULES.find((m) => m.key === key)
}

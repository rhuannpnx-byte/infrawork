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
            icon: 'bar-chart-3',
            label: 'Histograma planejado',
            route: '/planejamento/histograma',
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
            icon: 'gauge',
            label: 'Dashboard',
            route: '/acompanhamento',
            requiresObra: true,
            requiredRoles: ['god', 'adm', 'engenheiro', 'apoio']
          },
          {
            icon: 'calendar-days',
            label: 'Calendário',
            route: '/acompanhamento/calendario',
            requiresObra: true
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
            icon: 'scale',
            label: 'Previsto × Realizado',
            route: '/acompanhamento/comparativo',
            requiresObra: true
          }
        ]
      },
      {
        title: 'ADMINISTRAÇÃO',
        // Inclui eng/apoio para que Equipes/Alertas/Performance apareçam pra eles;
        // o Vínculo SIGA continua restrito a god/adm pelo requiredRoles do item.
        requiredRoles: ['god', 'adm', 'engenheiro', 'apoio'],
        items: [
          {
            icon: 'bar-chart-3',
            label: 'Performance',
            route: '/acompanhamento/performance',
            requiresObra: true,
            requiredRoles: ['god', 'adm', 'engenheiro', 'apoio']
          },
          {
            icon: 'users',
            label: 'Equipes',
            route: '/acompanhamento/equipes',
            requiresObra: true,
            requiredRoles: ['god', 'adm', 'engenheiro', 'apoio']
          },
          {
            icon: 'alert-triangle',
            label: 'Alertas',
            route: '/acompanhamento/alertas',
            requiresObra: true,
            requiredRoles: ['god', 'adm', 'engenheiro', 'apoio']
          },
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
  },
  {
    key: 'documentacao',
    title: 'Documentação Oficial',
    icon: 'book-open',
    shortcut: 'g d',
    routePrefix: '/documentacao',
    color: 'var(--accent)',
    category: 'engineering',
    // POR ENQUANTO restrito a GOD (em validação). Depois reabrir para os demais
    // perfis internos exceto cliente: ['god','adm','engenheiro','apoio'].
    requiredRoles: ['god'],
    pills: [],
    sections: [
      {
        title: 'OBRA',
        items: [
          { icon: 'scan-line', label: 'Raio-X', route: '/documentacao', requiresObra: true },
          {
            icon: 'folder-archive',
            label: 'Repositório',
            route: '/documentacao/repositorio',
            requiresObra: true
          }
        ]
      },
      {
        title: 'ANÁLISE',
        items: [
          {
            icon: 'scale',
            label: 'Cláusulas & Risco',
            route: '/documentacao/clausulas',
            requiresObra: true
          },
          { icon: 'share-2', label: 'Grafo', route: '/documentacao/grafo', requiresObra: true },
          {
            icon: 'git-commit-horizontal',
            label: 'Timeline',
            route: '/documentacao/timeline',
            requiresObra: true
          },
          {
            icon: 'sparkles',
            label: 'Conversar',
            route: '/documentacao/conversar',
            requiresObra: true
          }
        ]
      },
      {
        title: 'PRODUTOS',
        items: [
          {
            icon: 'file-output',
            label: 'Emitir TAP',
            route: '/documentacao/tap',
            requiresObra: true
          }
        ]
      },
      {
        title: 'CONFIG',
        items: [
          {
            icon: 'list-checks',
            label: 'Template de extração',
            route: '/documentacao/template',
            requiresObra: true
          }
        ]
      },
      {
        title: 'TÉCNICO',
        items: [
          {
            icon: 'scroll-text',
            label: 'Logs & Diagnóstico',
            route: '/documentacao/logs',
            requiresObra: true
          }
        ]
      }
    ]
  },
  {
    key: 'whatsapp',
    title: 'WhatsApp',
    icon: 'message-circle',
    shortcut: 'g w',
    routePrefix: '/whatsapp',
    color: 'var(--accent)',
    category: 'system',
    requiredRoles: ['god', 'adm'],
    pills: [],
    sections: [
      {
        title: 'MONITORAMENTO',
        requiredRoles: ['god', 'adm'],
        items: [
          { icon: 'qr-code', label: 'Sessão', route: '/whatsapp' },
          { icon: 'users', label: 'Grupos', route: '/whatsapp/grupos' },
          { icon: 'sparkles', label: 'Oráculo', route: '/whatsapp/oraculo' },
          { icon: 'history', label: 'Backfill', route: '/whatsapp/backfill' },
          { icon: 'list-checks', label: 'Log de fotos', route: '/whatsapp/log' }
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

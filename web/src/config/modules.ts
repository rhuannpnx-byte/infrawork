import type { ModuleConfig } from '@/types/module'

/**
 * Catálogo de módulos do app: a única fonte da navegação. A barra de módulos (ícones), o menu do módulo (páginas),
 * a busca, os atalhos "g + letra" e o título da aba do navegador saem daqui. Página nova entra num `sections`.
 */

/**
 * Prefixos de rota renderizados SEM o chrome (rail/sidebar/abas) — ex.: a tela
 * de lançamento de produção em celular.
 */
export const BARE_ROUTE_PREFIXES: string[] = ['/lancar']

export const MODULES: ModuleConfig[] = [
  {
    key: 'gerencial',
    title: 'Gerencial',
    icon: 'shield',
    shortcut: 'g g',
    routePrefix: '/gerencial',
    category: 'system',
    requiredRoles: ['god', 'adm', 'engenheiro'],
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
          },
          {
            icon: 'truck',
            label: 'Frota',
            route: '/gerencial/frota'
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
    category: 'engineering',
    requiredRoles: ['god', 'adm', 'engenheiro', 'apoio'],
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
            label: 'Planilha orçamentária',
            route: '/orcamento/obra/plan-orc',
            requiresObra: true
          },
          {
            icon: 'trending-up',
            label: 'Lucratividade',
            route: '/orcamento/obra/lucratividade',
            requiresObra: true
          }
        ]
      },
      {
        title: 'ALTERAÇÕES DO CONTRATO',
        items: [
          {
            icon: 'file-plus',
            label: 'Aditivos',
            route: '/orcamento/obra/aditivos',
            requiresObra: true
          },
          {
            icon: 'percent',
            label: 'Reajustes',
            route: '/orcamento/obra/reajustes',
            requiresObra: true
          },
          {
            icon: 'file-lock',
            label: 'Planilha inicial',
            route: '/orcamento/obra/planilha-inicial',
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
            label: 'Composições',
            route: '/orcamento/composicoes',
            requiresObra: true
          },
          {
            icon: 'briefcase',
            label: 'Indireto',
            route: '/orcamento/obra/indireto',
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
    category: 'engineering',
    requiredRoles: ['god', 'adm', 'engenheiro', 'apoio'],
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
            icon: 'chart-gantt',
            label: 'Cronograma',
            route: '/planejamento/cronograma',
            requiresObra: true
          }
        ]
      },
      {
        title: 'CONFIGURAÇÃO',
        items: [
          {
            icon: 'sliders-horizontal',
            label: 'Parametrização',
            route: '/planejamento/parametrizacao',
            requiresObra: true
          },
          {
            icon: 'calendar-days',
            label: 'Calendário',
            route: '/planejamento/calendario',
            requiresObra: true
          },
          {
            icon: 'users',
            label: 'Equipes',
            route: '/planejamento/equipes',
            requiresObra: true
          },
          {
            icon: 'route',
            label: 'Locais',
            route: '/planejamento/trechos',
            requiresObra: true
          }
        ]
      },
      {
        title: 'ANÁLISE',
        items: [
          {
            icon: 'chart-spline',
            label: 'Tempo-caminho',
            route: '/planejamento/tempo-caminho',
            requiresObra: true
          },
          {
            icon: 'trending-up',
            label: 'Curva S',
            route: '/planejamento/curva-s',
            requiresObra: true
          },
          {
            icon: 'bar-chart-3',
            label: 'Histograma de recursos',
            route: '/planejamento/recursos',
            requiresObra: true
          },
          {
            icon: 'git-compare',
            label: 'Comparar planos',
            route: '/planejamento/comparar',
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
    category: 'engineering',
    alerta: 'alertas-da-obra',
    requiredRoles: ['god', 'adm', 'engenheiro', 'apoio', 'cliente'],
    sections: [
      {
        title: 'OBRA',
        items: [
          // Itens SEM requiredRoles são visíveis ao Cliente (Calendário, Fotos e mapa,
          // Previsto e realizado, e a Produção, em Controles). Os demais excluem 'cliente'
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
            label: 'Valor agregado',
            route: '/acompanhamento/valor-agregado',
            requiresObra: true,
            requiredRoles: ['god', 'adm', 'engenheiro', 'apoio']
          },
          {
            icon: 'map-pin',
            label: 'Fotos e mapa',
            route: '/acompanhamento/fotos',
            requiresObra: true
          },
          {
            icon: 'scale',
            label: 'Previsto e realizado',
            route: '/acompanhamento/comparativo',
            requiresObra: true
          },
          {
            icon: 'bar-chart-3',
            label: 'Performance',
            route: '/acompanhamento/performance',
            requiresObra: true,
            requiredRoles: ['god', 'adm', 'engenheiro', 'apoio']
          }
        ]
      },
      {
        // O que se lança e se confere no dia a dia. O lançamento de produção é um modal da página Produção.
        title: 'CONTROLES',
        items: [
          {
            icon: 'list-checks',
            label: 'Produção',
            route: '/acompanhamento/producao',
            requiresObra: true
          },
          {
            icon: 'truck',
            label: 'Viagens',
            route: '/acompanhamento/viagens',
            requiresObra: true,
            requiredRoles: ['god', 'adm', 'engenheiro', 'apoio']
          },
          {
            icon: 'package',
            label: 'Estoque',
            route: '/acompanhamento/estoque',
            requiresObra: true,
            requiredRoles: ['god', 'adm', 'engenheiro', 'apoio']
          }
        ]
      },
      {
        title: 'ADMINISTRAÇÃO',
        requiredRoles: ['god', 'adm', 'engenheiro', 'apoio'],
        items: [
          {
            icon: 'users',
            label: 'Equipes e encarregados',
            route: '/acompanhamento/equipes',
            requiresObra: true,
            requiredRoles: ['god', 'adm', 'engenheiro', 'apoio']
          },
          {
            icon: 'map-pinned',
            label: 'Origens e destinos',
            route: '/acompanhamento/transporte',
            requiresObra: true,
            requiredRoles: ['god', 'adm', 'engenheiro', 'apoio']
          },
          {
            icon: 'alert-triangle',
            label: 'Alertas',
            route: '/acompanhamento/alertas',
            requiresObra: true,
            requiredRoles: ['god', 'adm', 'engenheiro', 'apoio']
          }
        ]
      }
    ]
  }
]

/** Início: módulo sem páginas (não abre o menu do módulo). */
export const MODULO_INICIO: ModuleConfig = {
  key: 'home',
  title: 'Início',
  icon: 'home',
  shortcut: 'g h',
  routePrefix: '/',
  sections: []
}

/** Grupos da barra de módulos, de cima para baixo, separados por uma linha. */
export const GRUPOS_BARRA: { key: string; modulos: string[] }[] = [
  { key: 'inicio', modulos: ['home'] },
  { key: 'obra', modulos: ['orcamento', 'planejamento', 'acompanhamento'] },
  { key: 'sistema', modulos: ['gerencial'] }
]

export function getModuleByRoute(pathname: string): ModuleConfig | undefined {
  return MODULES.find((m) => pathname.startsWith(m.routePrefix))
}

export function getModuleByKey(key: string): ModuleConfig | undefined {
  return MODULES.find((m) => m.key === key)
}

export function isBareRoute(pathname: string): boolean {
  return BARE_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

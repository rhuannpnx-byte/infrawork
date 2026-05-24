# InfraWork

> Aplicação desktop para gestão integrada de obras rodoviárias — planejamento, orçamento, acompanhamento, medições, suprimentos, equipe, documentos e relatórios.

![status](https://img.shields.io/badge/status-scaffold-blue) ![stack](https://img.shields.io/badge/stack-Electron%20%2B%20React%2019%20%2B%20TS-181a23)

## Visão geral

O InfraWork é uma aplicação Electron pensada para engenheiros de planejamento e orçamento de empreiteiras de médio/grande porte. A estética é técnica e densa — referência Palantir Gotham — com tipografia IBM Plex e accent azul-frio sobre um dark mode profissional.

Este repositório contém o **scaffold completo do frontend** com **todos os dados mockados**. A camada de API foi construída para ser substituída pelo backend real **sem qualquer alteração nos componentes** — basta trocar duas variáveis de ambiente (ver [Backend real](#trocar-para-o-backend-real)).

## Stack

| Camada | Lib |
|---|---|
| Bundler | electron-vite |
| UI | React 19, TypeScript, Tailwind CSS, primitivos shadcn (escritos manualmente) |
| Roteamento | TanStack Router (code-based) |
| Estado servidor | TanStack Query |
| Estado UI | Zustand |
| Tabelas | TanStack Table |
| Formulários | react-hook-form + zod |
| Charts | Recharts |
| Gantt | frappe-gantt (vanilla SVG, embrulhado em wrapper React) |
| Command palette | cmdk |
| Toasts | sonner |
| Atalhos | react-hotkeys-hook |
| Settings | electron-store |
| Ícones | lucide-react |
| Mocks | axios-mock-adapter |

> **Por que frappe-gantt em vez de gantt-task-react?** A versão atual do `gantt-task-react` não suporta React 19. O `frappe-gantt` é SVG puro, MIT, e totalmente customizável via CSS — feito sob medida para o tema dark do app.

## Estrutura

```
src/
├── main/                          # Electron main process (multi-janela, IPC, electron-store)
├── preload/                       # Bridge IPC tipada (window.infrawork)
└── renderer/src/
    ├── app/                       # Router + providers + páginas
    ├── components/
    │   ├── ui/                    # Primitivos (Button, Input, Dialog, …)
    │   ├── layout/                # AppShell, TopTabBar, PrimaryRail, Sidebar, StatusBar
    │   ├── modals/                # CommandPalette, ProjectSwitcher, NewComposition, …
    │   ├── charts/                # Recharts já tematizados
    │   ├── gantt/                 # Wrapper React do frappe-gantt + tema dark
    │   ├── data-table/            # DataTable genérico + colunas por entidade
    │   └── forms/                 # Campos especiais (currency, percent, …)
    ├── config/
    │   └── modules.ts             # ← Single source of truth da navegação por módulo
    ├── features/                  # Hooks de domínio (useCompositions, useTarefas, …)
    ├── lib/
    │   ├── api/                   # Client + endpoints + mock adapter
    │   ├── mock-data/             # Dados sintéticos
    │   ├── format/                # Formatadores pt-BR
    │   └── ipc/                   # Wrapper sobre window.infrawork
    ├── stores/                    # Zustand
    ├── types/                     # Tipos de domínio + módulos
    └── styles/                    # Globals + theme.css (CSS variables)
```

## Como rodar

### Pré-requisitos
- Node.js 20+
- npm 10+

### Instalação

```bash
npm install
```

### Desenvolvimento

```bash
npm run dev
```

O Electron abre uma janela 1440×900 com HMR.

### Type-check

```bash
npm run typecheck
```

### Build

```bash
npm run build           # gera bundle pro renderer/main/preload
npm run build:win       # empacota para Windows (NSIS)
npm run build:mac       # empacota para macOS
npm run build:linux     # empacota para Linux (AppImage, snap, deb)
```

## Atalhos de teclado

| Atalho | Ação |
|---|---|
| `Cmd/Ctrl + K` | Paleta de comandos |
| `G O` | Ir para Orçamento |
| `G P` | Planejamento |
| `G A` | Acompanhamento |
| `G M` | Medições |
| `G S` | Suprimentos |
| `G E` | Equipe |
| `G D` | Documentos |
| `G R` | Relatórios |
| `G H` | Visão geral |
| `Cmd + B` | Mostrar/ocultar sidebar |
| `Cmd + W` | Fechar aba |
| `Cmd + 1..9` | Ir para aba N |
| `Cmd + Shift + T` | Reabrir última aba fechada |
| `?` | Mostrar overlay de atalhos |
| `Esc` | Fechar modal/sheet |

Sequências estilo Vim/Linear: pressione `G` e em até 800ms a tecla do módulo.

## Trocar para o backend real

A camada `lib/api` foi desenhada para essa troca. Em produção, defina duas variáveis de ambiente antes do build/dev:

```bash
VITE_USE_MOCK=false
VITE_API_URL=https://api.infrawork.tecpav.com.br
```

Com isso, o `axios-mock-adapter` não é mais carregado — todas as queries vão direto para a URL real. **Nenhum componente, hook ou store precisa ser tocado.**

O contrato dos endpoints está em `src/renderer/src/lib/api/endpoints/`. Veja [`docs/architecture.md`](docs/architecture.md) para detalhes.

## Autenticação & RBAC (Supabase)

O módulo de auth + autorização vive em [`supabase/`](supabase/README.md) — schema, RLS policies, seed do usuário God e Edge Functions para operações privilegiadas (criar empresa, usuário, obra, conceder/revogar acesso).

Hierarquia de papéis: **God → Adm → Engenheiro → Apoio**. RLS é a camada primária; Edge Functions adicionam defesa em profundidade. Veja [`supabase/README.md`](supabase/README.md) para o passo a passo de setup local e remoto.

Para habilitar a tela de login no renderer:

```dotenv
VITE_USE_SUPABASE=true
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

Sem essas variáveis, o app continua bootando em modo mock com uma sessão sintética de God (apenas DEV).

## Documentação adicional

- [`docs/architecture.md`](docs/architecture.md) — fluxo de dados, padrão de hooks, como adicionar módulo/modal
- [`supabase/README.md`](supabase/README.md) — setup do banco, RLS, Edge Functions e testes RBAC
- [`CHANGELOG.md`](CHANGELOG.md) — histórico das mudanças do scaffold

## Licença

Privado — TECPAV © 2026.

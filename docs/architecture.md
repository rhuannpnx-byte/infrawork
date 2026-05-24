# InfraWork — Arquitetura

Este documento explica como os pedaços do frontend se conectam, o padrão de hooks/dados, e os roteiros para estender o app — adicionar um módulo, adicionar um modal, trocar pelo backend real.

## Fluxo de dados

```
┌─────────────────────────────────────────────────────────────────────┐
│  Componentes de página (src/renderer/src/app/routes/**)             │
│  ↓ chama                                                            │
│  Hook de feature (src/renderer/src/features/<dom>/hooks)            │
│  ↓ usa useQuery / useMutation                                       │
│  Endpoint tipado (src/renderer/src/lib/api/endpoints/<dom>.ts)      │
│  ↓ axios                                                            │
│  apiClient (src/renderer/src/lib/api/client.ts)                     │
│  ↓ se VITE_USE_MOCK !== 'false':                                    │
│  axios-mock-adapter (src/renderer/src/lib/api/mock-adapter.ts)      │
│  ↓ responde com…                                                    │
│  mock-data (src/renderer/src/lib/mock-data/*)                       │
└─────────────────────────────────────────────────────────────────────┘
```

Nenhum componente conhece se está consumindo mock ou backend real — todos passam por `apiClient`. Trocar é mudar duas variáveis de ambiente:

```bash
VITE_USE_MOCK=false
VITE_API_URL=https://api.infrawork.tecpav.com.br
```

### Server state vs UI state

- **Server state** → React Query (`@tanstack/react-query`). Cache, refetch, mutações, invalidação. **Nunca duplicar em Zustand.**
- **UI state** → Zustand (`src/renderer/src/stores`). Modais abertos, sidebar visível, abas, preferências, tema, BDI default.

## Camada de UI

### Tokens

`styles/theme.css` é a fonte das CSS variables. O Tailwind apenas mapeia: `bg-bg`, `text-text`, `border-border-strong`, `bg-accent-glow`, etc. **Sempre prefira a variable** (mudar tema futuro = trocar `theme.css`).

### Primitivos

`components/ui/` traz primitivos densos (Button h-7, Input h-7, Dialog com header/body/footer). Estão escritos à mão — não importados via `npx shadcn add` — para garantir paddings/alturas técnicos.

### Layout

`components/layout/AppShell.tsx` define o grid 4×3:

```
┌─────────────────────────────────────┐
│ TopTabBar (34px)                    │
├─────────────────────────────────────┤
│ MenuBar (30px)                      │
├──────┬──────────┬───────────────────┤
│ Rail │ Sidebar  │ Main              │
│ 44px │ 268px    │ 1fr               │
├──────┴──────────┴───────────────────┤
│ StatusBar (22px)                    │
└─────────────────────────────────────┘
```

A `SecondarySidebar` é dirigida pelo `config/modules.ts` — qualquer mudança nos pills, info card, seções ou items se reflete automaticamente.

## Padrão de hooks de feature

Um hook de feature é **simples**, fino, sem lógica:

```ts
// src/renderer/src/features/orcamento/hooks/index.ts
export function useCompositions() {
  return useQuery({
    queryKey: ['compositions'],
    queryFn: orcamentoApi.listCompositions
  })
}
```

Convenções:

- `queryKey` no plural com o nome da entidade: `['compositions']`, `['insumos']`, `['tarefas']`, `['boletins']`.
- Para detalhe: `['composition', id]`.
- Mutações invalidam o cache: `onSuccess: () => qc.invalidateQueries({ queryKey: ['compositions'] })`.

## Como adicionar um novo módulo

1. **Tipos de domínio** em `src/renderer/src/types/domain.ts` se houver novas entidades.
2. **Mock data** em `src/renderer/src/lib/mock-data/<nome>.ts`.
3. **Endpoint** em `src/renderer/src/lib/api/endpoints/<nome>.ts`:
   ```ts
   export const fooApi = {
     listFoos: () => apiClient.get<Foo[]>('/foos').then(r => r.data)
   }
   ```
4. **Mock adapter**: adicione a rota em `src/renderer/src/lib/api/mock-adapter.ts`.
5. **Hooks** em `src/renderer/src/features/<nome>/hooks/index.ts`.
6. **Página(s)** em `src/renderer/src/app/routes/<nome>/index.tsx`.
7. **Rota**: importe a página em `src/renderer/src/app/router.tsx` e adicione um par `layout/index` ao `routeTree`.
8. **Sidebar**: adicione uma entrada em `src/renderer/src/config/modules.ts` com seções/items.
9. **Atalho** (`useShortcuts.ts`): inclua na sequência `G + letra`.
10. **Command palette**: aparece automaticamente porque lê de `MODULES`.

## Como adicionar um novo modal

1. Crie em `src/renderer/src/components/modals/MeuModal.tsx`. Esqueleto:
   ```tsx
   export function MeuModal() {
     const open = useUIStore(s => s.activeModals.has('meuModal'))
     const close = () => useUIStore.getState().closeModal('meuModal')

     return (
       <Dialog open={open} onOpenChange={(o) => !o && close()}>
         <DialogHeader>
           <DialogTitle>Título</DialogTitle>
         </DialogHeader>
         <DialogBody>{/* … */}</DialogBody>
         <DialogFooter>
           <Button variant="ghost" onClick={close}>Cancelar</Button>
           <Button variant="default">OK</Button>
         </DialogFooter>
       </Dialog>
     )
   }
   ```
2. Adicione a chave em `ModalKey` (em `src/renderer/src/stores/ui-store.ts`).
3. Registre em `src/renderer/src/components/modals/Modals.tsx`.
4. Para abrir de qualquer lugar: `useUIStore.getState().openModal('meuModal')` ou via `onClick` numa `ModuleAction`.

## Sistema de abas

`tabs-store.ts` mantém uma lista de `DocumentTab`. `openTab({ title, icon, route, ... })` reutiliza a aba se a rota já estiver aberta — não duplica.

Convenção: páginas de detalhe (`/orcamento/composicoes/$id`, futuramente `/planejamento/tarefas/$id`, etc.) chamam `openTab` ao serem abertas via DataTable.

## Atalhos

`useShortcuts.ts` é registrado no `Providers.tsx`. A sequência Vim-style usa um state machine simples: `g` pressionado → `waitingForG = true` → próxima tecla em até 800ms é resolvida pelo mapa `GO_SEQUENCE_MAP`. Pressionar `g` dentro de um input/textarea é ignorado.

## Electron main process

`src/main/index.ts` cuida de:

- **Janela principal** 1440×900 (min 1280×800), com persistência de geometria via `electron-store`.
- **Multi-janela**: `ipcMain.handle('window:open', route)` cria uma nova janela carregando a mesma URL com hash de rota.
- **Settings**: `settings:get` / `settings:set` armazenam preferências do usuário em `electron-store`.
- **Menu nativo** em pt-BR (Arquivo / Editar / Exibir / Janela / Ajuda).

O renderer fala com o main via `window.infrawork.window.openNew(route)` etc. (tipos em `src/preload/index.d.ts`, wrappers em `src/renderer/src/lib/ipc/window.ts`).

## Trocar para o backend real — checklist

- [ ] Verifique que **todos** os endpoints em `lib/api/endpoints/` apontam para paths que existem no backend.
- [ ] Confira o formato dos payloads vs `types/domain.ts` (se divergir, ajuste o tipo, não o componente).
- [ ] Configure `.env.production`:
  ```
  VITE_USE_MOCK=false
  VITE_API_URL=https://api.infrawork.tecpav.com.br
  ```
- [ ] Rode `npm run build` — o `mock-adapter.ts` não deve ser incluído no bundle final (importação dinâmica condicional).
- [ ] Configure autenticação no `apiClient.ts` (interceptor com token Bearer, refresh, etc.).
- [ ] Teste cada módulo em ambiente staging — o esqueleto de loading/erro já cobre os estados.

## Onde tudo mora — referência rápida

| O que | Onde |
|---|---|
| Cores, tipografia | `styles/theme.css`, `tailwind.config.js` |
| Navegação por módulo | `config/modules.ts` |
| Atalhos | `hooks/useShortcuts.ts` |
| Stores | `stores/{ui,project,tabs,settings}-store.ts` |
| API | `lib/api/{client,endpoints,mock-adapter}.ts` |
| Formatadores pt-BR | `lib/format/{currency,date,number,percent}.ts` |
| Tipos | `types/domain.ts`, `types/module.ts` |
| Mock data | `lib/mock-data/*` |
| Hooks de feature | `features/<dom>/hooks/index.ts` |
| Páginas | `app/routes/<dom>/*.tsx` |
| Router | `app/router.tsx` |
| Providers (Query, Toast, Shortcuts) | `app/Providers.tsx` |
| Entry | `main.tsx` |
| Electron main | `src/main/index.ts` |
| Preload bridge | `src/preload/index.ts` + `index.d.ts` |

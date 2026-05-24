# Como cortar uma release do InfraWork

Pipeline: push de tag `vX.Y.Z` → GitHub Actions builda o instalador Windows → publica como **Release rascunho** com `latest.yml` e `.exe` anexados → você revisa as notas e clica **Publish** → clientes instalados detectam a atualização e baixam automaticamente.

## Fluxo padrão (patch / bugfix)

```powershell
# 1) Atualizar o CHANGELOG.md adicionando uma seção [X.Y.Z] no topo.
#    Convenção: ## [0.1.1] - 2026-05-30
#    - feat: novo card de produtividade no dashboard
#    - fix: corrige erro ao filtrar fotos por GPS

# 2) Bump da versão. Cria commit + tag local.
npm version patch  # ou minor / major
# (resulta em commit "0.1.1" e tag "v0.1.1")

# 3) Push do commit + tag — dispara o workflow Release.
git push
git push --tags

# 4) Acompanhar o build.
gh run watch  # ou: gh run list --workflow=release.yml

# 5) Quando terminar (~8–12min), revisar o draft.
gh release view v0.1.1 --web
#  → adicionar Release notes (copiar do CHANGELOG)
#  → clicar "Publish release" (sai de Draft pra Latest)

# 6) Pronto. Clientes na v0.1.0 vão receber toast "Atualização disponível"
#    na próxima abertura (ou em até 4h se ficarem com o app aberto).
```

## Fluxo manual (sem npm version)

Caso precise tagear uma release sem bumpar `package.json`:

```powershell
git tag v0.1.1
git push origin v0.1.1
```

## Build local pra teste (sem publicar)

```powershell
npm run release:draft  # gera dist/InfraWork-Setup-X.Y.Z.exe localmente, sem upload
```

## Re-rodar um workflow que falhou

```powershell
gh run rerun <run-id>  # ou via web: Actions → run → Re-run all jobs
```

## Deletar uma release de teste

```powershell
gh release delete v0.1.1-test --yes --cleanup-tag
```

## Decisões / observações

- **Repo é privado, mas os assets do Release são públicos** — é o que permite o auto-updater funcionar sem token embutido no app. Não mude isso a menos que esteja preparado para integrar autenticação no updater.
- **`releaseType: draft`** no `electron-builder.yml` garante que toda release sai como rascunho — você sempre tem chance de revisar antes de notificar os usuários.
- **Sem code signing** — `.exe` não assinado. Usuários novos veem alerta SmartScreen "Editor desconhecido" na 1ª instalação. Resolvível depois com certificado (Sectigo ~$200/ano ou Azure Trusted Signing).
- **Auto-update verifica a cada 4h** enquanto o app fica aberto, além da checagem inicial no startup. O usuário pode forçar via `window.infrawork.updater.check()` (sem UI ainda).
- **Workflow falha se** o `package-lock.json` não estiver commitado, ou se os secrets `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` sumirem do repo.

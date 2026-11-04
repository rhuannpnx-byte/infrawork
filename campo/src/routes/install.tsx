import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, Smartphone, Apple } from 'lucide-react'
import { Button } from '@/core/ui/Button'

/**
 * Página de download e instruções de instalação.
 *
 * Foco Android: oferece o APK direto pra sideload. PWA continua sendo a opção
 * pra iOS (Safari → Compartilhar → Adicionar à Tela de Início) e desktop.
 *
 * Hospedagem do APK: ele é colocado em `web/public/downloads/infrawork-latest.apk`
 * MANUALMENTE depois do `npm run build:android:release` + assinatura. Não vai
 * pro git (gitignore). Cloudflare Pages serve direto.
 */
const APK_URL = '/downloads/infrawork-latest.apk'

export function InstallRoute() {
  const navigate = useNavigate()
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isAndroid = /Android/i.test(ua)
  const isIos = /iPhone|iPad|iPod/i.test(ua)

  return (
    <main className="flex min-h-svh flex-col bg-bg-base">
      <header className="sticky top-0 z-10 border-b border-border bg-bg-base/95 backdrop-blur pt-safe pl-safe pr-safe">
        <div className="flex items-center gap-2 px-2 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Voltar">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold text-on-surface">Instalar InfraWork</h1>
        </div>
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 space-y-6 overflow-y-auto p-4">
        {/* Card Android — destaque se for Android */}
        <section
          className={`rounded-lg border p-5 ${
            isAndroid ? 'border-accent bg-accent/5' : 'border-border bg-bg-panel'
          }`}
        >
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/15 text-accent">
              <Smartphone className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold text-on-surface">App Android (APK)</h2>
              <p className="text-xs text-on-surface-dim">
                Recomendado pra operadores no campo — câmera e storage nativos
              </p>
            </div>
          </div>
          <ul className="mb-4 list-disc space-y-1.5 pl-5 text-sm text-on-surface-dim">
            <li>Câmera nativa do Android (autofocus melhor)</li>
            <li>Fotos no filesystem real (não no IndexedDB)</li>
            <li>Menos travamentos com muitas fotos pendentes</li>
            <li>Sincroniza ao reabrir o app</li>
          </ul>

          <a
            href={APK_URL}
            download="infrawork.apk"
            className="inline-flex h-12 items-center gap-2 rounded-md bg-accent px-5 font-semibold text-accent-fg transition-colors hover:bg-accent-dark active:bg-accent-dark"
          >
            <Download className="h-5 w-5" />
            Baixar APK
          </a>

          <details className="mt-4 text-xs text-on-surface-dim">
            <summary className="cursor-pointer font-medium text-on-surface">
              Como instalar (primeira vez)
            </summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5">
              <li>Baixe o APK acima</li>
              <li>Abra o arquivo baixado (notificação do download ou gerenciador de arquivos)</li>
              <li>
                Se o Android pedir, autorize <strong>"Instalar fontes desconhecidas"</strong> só pra
                esse arquivo
              </li>
              <li>
                Toque em <strong>Instalar</strong>
              </li>
              <li>
                Abra o ícone <strong>InfraWork</strong> que apareceu na tela inicial
              </li>
            </ol>
          </details>
        </section>

        {/* Card PWA — Safari iOS ou outros browsers */}
        <section
          className={`rounded-lg border p-5 ${
            isIos ? 'border-accent bg-accent/5' : 'border-border bg-bg-panel'
          }`}
        >
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-info/15 text-info">
              <Apple className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold text-on-surface">PWA (iPhone / outros)</h2>
              <p className="text-xs text-on-surface-dim">
                Funciona em qualquer device — instala via browser
              </p>
            </div>
          </div>

          {isIos ? (
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-on-surface-dim">
              <li>
                No Safari, toque no botão <strong>Compartilhar</strong> (quadradinho com seta)
              </li>
              <li>
                Role pra baixo e toque em <strong>"Adicionar à Tela de Início"</strong>
              </li>
              <li>
                Confirme <strong>Adicionar</strong>
              </li>
              <li>O ícone InfraWork vai aparecer na sua tela inicial</li>
            </ol>
          ) : (
            <p className="text-sm text-on-surface-dim">
              No Chrome (Android/Desktop): menu (⋮) → <strong>Instalar app</strong>. No Safari iOS:
              Compartilhar → <strong>Adicionar à Tela de Início</strong>.
            </p>
          )}
        </section>

        <p className="pt-2 text-center text-xs text-on-surface-muted">
          Operadores podem usar APK e PWA no mesmo aparelho. Login funciona nos dois.
        </p>
      </div>
    </main>
  )
}

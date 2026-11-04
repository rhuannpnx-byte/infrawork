import { useEffect, useState } from 'react'
import { Share } from 'lucide-react'
import { isIosSafari, isStandalone } from '@/core/platform/install'

/**
 * Banner instrutivo para iOS Safari NÃO instalado como standalone.
 *
 * Por que não é dispensável:
 *  - Sem instalar como standalone, Safari mostra URL bar + toolbar no app, cobrindo
 *    parte da viewport e atrapalhando a UX em todas as telas internas.
 *  - O usuário acha que é "bug" — ao tocar em qualquer card a chrome reaparece.
 *  - A solução é instalar pela Tela de Início. Dispensar não resolve, só esconde
 *    a única forma de evitar o problema.
 *
 * Esconde automaticamente quando:
 *  - Não estiver em iOS Safari (Android/Chrome têm install nativo)
 *  - Já estiver rodando standalone (display-mode: standalone OU navigator.standalone)
 */
export function IosInstallBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const evaluate = () => {
      setShow(isIosSafari() && !isStandalone())
    }
    evaluate()
    // standalone pode mudar se o usuário instalar e voltar pra mesma aba
    const mq = window.matchMedia('(display-mode: standalone)')
    mq.addEventListener('change', evaluate)
    return () => mq.removeEventListener('change', evaluate)
  }, [])

  if (!show) return null

  return (
    <div className="flex items-start gap-3 border-b border-accent/40 bg-accent/15 px-4 py-2.5 text-sm">
      <Share className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent" />
      <div className="flex-1">
        <p className="font-medium text-on-surface">Instale na Tela de Início</p>
        <p className="mt-0.5 text-xs text-on-surface-dim">
          Sem instalar, o Safari aparece e tampa parte da tela. Toque em{' '}
          <span className="inline-flex items-baseline align-middle">
            <Share className="relative top-0.5 mx-0.5 inline h-3 w-3" />
          </span>{' '}
          (Compartilhar) → <strong>Adicionar à Tela de Início</strong>.
        </p>
      </div>
    </div>
  )
}

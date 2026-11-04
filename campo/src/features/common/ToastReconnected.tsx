import { useEffect, useRef } from 'react'
import { isBackendReachable } from '@/core/network/onlineProbe'
import { triggerForegroundSync } from '@/core/sync/foregroundSync'
import { showToast } from './toastBus'

/**
 * Substitui o `NetworkStatusBanner` fixed-top antigo. Não renderiza nada visível
 * em estado normal — apenas dispara um toast `ok` curto quando detecta transição
 * offline → online (banner era intrusivo: ocupava ~40px da viewport sempre).
 *
 * Estratégia:
 *  - Inicia rastreando `navigator.onLine`.
 *  - Escuta evento `online` do browser; confirma com `isBackendReachable()` pra
 *    descartar false positive (iOS).
 *  - Probe periódico de 15s SOMENTE quando offline — quando reconnecta, dispara
 *    toast + trigger imediato de sync.
 *
 * O estado de "outbox pendente" e "sincronizando" é mostrado pelo `SyncStatusIndicator`
 * nas toolbars das rotas, não aqui.
 */
export function ToastReconnected() {
  const onlineRef = useRef<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true)

  useEffect(() => {
    function notifyReconnect() {
      if (onlineRef.current) return // já online — evita toast duplicado
      onlineRef.current = true
      showToast('ok', 'Conexão restabelecida')
      void triggerForegroundSync('reconnect', { ignoreCooldown: true })
    }

    function notifyOffline() {
      if (!onlineRef.current) return
      onlineRef.current = false
      // Sem toast aqui — o SyncStatusIndicator já mostra estado offline
      // discretamente. Toast em offline seria barulhento (operador no campo
      // perde sinal o tempo todo).
    }

    function onOnline() {
      void isBackendReachable().then((ok) => {
        if (ok) notifyReconnect()
      })
    }

    function onOffline() {
      notifyOffline()
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    // Probe 15s só enquanto offline (alguns devices não disparam 'online'
    // confiavelmente — ex: iOS depois de Wi-Fi → 4G).
    const interval = window.setInterval(async () => {
      if (onlineRef.current) return
      const ok = await isBackendReachable()
      if (ok) notifyReconnect()
    }, 15_000)

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.clearInterval(interval)
    }
  }, [])

  return null
}

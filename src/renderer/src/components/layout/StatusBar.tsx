import { type ReactNode, useEffect, useState } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { useAuthStore } from '@/stores/auth-store'
import { SUPABASE_ENABLED } from '@/lib/supabase/client'

function timeAgoLabel(ms: number): string {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `há ${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `há ${min} min`
  return `há ${Math.floor(min / 60)} h`
}

export function StatusBar(): ReactNode {
  const zoom = useSettingsStore((s) => s.zoom)
  const status = useAuthStore((s) => s.status)
  const empresa = useAuthStore((s) => s.empresa)
  const obras = useAuthStore((s) => s.obras)
  const [now, setNow] = useState(Date.now())
  const [bootAt] = useState(Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const connected = SUPABASE_ENABLED && status === 'authenticated'

  return (
    <div
      style={{ gridArea: 'status' }}
      className="bg-bg-tabs border-t border-border flex items-center px-3 gap-4 text-2xs font-mono text-text-dim"
    >
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-success' : 'bg-text-faint'}`} />
        <span>{connected ? `Conectado · ${timeAgoLabel(now - bootAt)}` : SUPABASE_ENABLED ? 'Offline' : 'Modo local'}</span>
      </div>
      {empresa ? (
        <>
          <span>·</span>
          <span>{empresa.nome}</span>
        </>
      ) : null}
      <span>·</span>
      <span>{obras.length} {obras.length === 1 ? 'obra' : 'obras'}</span>

      <div className="flex-1" />

      <span>UTC-03</span>
      <span>·</span>
      <span>UTF-8</span>
      <span>·</span>
      <span>{zoom}%</span>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { aplicarNovaVersao, haNovaVersao } from '@/core/pwa/novaVersao'

/**
 * Faixa "Nova versão disponível". Antes o app recarregava sozinho no meio de um lançamento; agora o operador
 * escolhe a hora (o rascunho da produção e as fichas ficam gravados no aparelho, então atualizar não perde nada).
 */
export function NovaVersaoBanner() {
  const [pronta, setPronta] = useState(haNovaVersao)
  const [atualizando, setAtualizando] = useState(false)
  useEffect(() => {
    const on = () => setPronta(true)
    window.addEventListener('campo:nova-versao', on)
    return () => window.removeEventListener('campo:nova-versao', on)
  }, [])
  if (!pronta) return null
  return (
    <div className="sticky top-0 z-40 border-b border-accent-line bg-bg-elevated">
      <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2 text-sm">
        <RefreshCw className="h-4 w-4 shrink-0 text-accent" aria-hidden />
        <p className="min-w-0 flex-1 text-on-surface">Nova versão do app disponível.</p>
        <button
          type="button"
          disabled={atualizando}
          onClick={() => {
            setAtualizando(true)
            aplicarNovaVersao()
          }}
          className="min-h-touch shrink-0 rounded-md bg-accent px-4 font-semibold text-accent-fg disabled:opacity-60"
        >
          {atualizando ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>
    </div>
  )
}

import { useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { useIsAuthenticated } from '@/core/auth/SessionStore'
import { useCarreteiroStore } from '@/features/carreteiro/carreteiroStore'
import { salvarFicha } from '@/features/carreteiro/carreteiroRepo'
import { formatBR, formatNumero } from '@/lib/datas'
import { contar } from '@/lib/texto'

/** Passo 3 — revisão: total por serviço (é o que vira a produção do dia) e gravação na fila. */
export function CarreteiroStep2Route() {
  const authed = useIsAuthenticated()
  const navigate = useNavigate()
  const ficha = useCarreteiroStore((s) => s.ficha)
  const fechar = useCarreteiroStore((s) => s.fechar)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // depois de gravar a ficha sai do rascunho: sem isto, o desvio abaixo levava à lista e a tela final não aparecia
  const gravou = useRef(false)

  if (!authed) return <Navigate to="/login" replace />
  if (!ficha) return gravou.current ? null : <Navigate to="/carreteiro" replace />

  const porServico = new Map<
    string,
    { nome: string; un: string | null; qtd: number; n: number; mat: number }
  >()
  for (const v of ficha.viagens) {
    const t = porServico.get(v.servicoId) ?? {
      nome: v.servicoNome,
      un: v.unidade,
      qtd: 0,
      n: 0,
      mat: 0,
    }
    t.qtd += v.quantidade
    t.n += 1
    t.mat += v.materialQtd ?? 0
    porServico.set(v.servicoId, t)
  }

  async function gravar() {
    setSalvando(true)
    setErro(null)
    try {
      const { pushResult } = await salvarFicha(ficha!)
      gravou.current = true
      fechar()
      navigate('/carreteiro/success', {
        replace: true,
        state: { fichaId: ficha!.id, pushResult, viagens: ficha!.viagens.length },
      })
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível gravar a ficha. Tente de novo.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <main className="flex min-h-svh flex-col bg-bg-base">
      <header className="sticky top-0 z-10 border-b border-border bg-bg-base pt-safe pl-safe pr-safe">
        <div className="flex items-center gap-2 px-2 py-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/carreteiro/step1')}
            aria-label="Voltar"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold text-on-surface">Revisar ficha</h1>
        </div>
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 space-y-3 p-4">
        <dl className="card-surface-variant grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-4 py-3 text-sm text-on-surface">
          <dt className="text-on-surface-dim">Data</dt>
          <dd className="tabular">{formatBR(ficha.dt)}</dd>
          <dt className="text-on-surface-dim">Caminhão</dt>
          <dd>{ficha.veiculoNome ?? '—'}</dd>
          {ficha.motorista && (
            <>
              <dt className="text-on-surface-dim">Motorista</dt>
              <dd>{ficha.motorista}</dd>
            </>
          )}
          {(ficha.encarregadoNome || ficha.equipeNome) && (
            <>
              <dt className="text-on-surface-dim">Equipe</dt>
              <dd>{[ficha.encarregadoNome, ficha.equipeNome].filter(Boolean).join(' · ')}</dd>
            </>
          )}
        </dl>
        <p className="rotulo pt-1">Produção do dia (soma das viagens)</p>
        <ul className="space-y-2">
          {[...porServico.entries()].map(([id, t]) => (
            <li key={id} className="card-surface px-4 py-3">
              <p className="font-medium text-on-surface">{t.nome}</p>
              <p className="tabular text-lg font-semibold text-accent">
                {formatNumero(t.qtd, 2)} {t.un ?? ''}
                <span className="text-xs font-normal text-on-surface-dim">
                  {' '}
                  · {contar(t.n, 'viagem', 'viagens')}
                </span>
              </p>
              {t.mat > 0 && (
                <p className="text-xs text-on-surface-dim">
                  Material informado: {formatNumero(t.mat, 2)}
                </p>
              )}
            </li>
          ))}
        </ul>
        {erro && (
          <p role="alert" className="text-sm text-bad">
            {erro}
          </p>
        )}
      </div>

      <div className="sticky bottom-0 border-t border-border bg-bg-base pt-4 pb-safe-plus-4 px-safe-4">
        <Button
          variant="primary"
          size="lg"
          disabled={salvando}
          onClick={() => void gravar()}
          className="w-full"
        >
          {salvando ? 'Gravando…' : 'Gravar ficha'}
        </Button>
      </div>
    </main>
  )
}

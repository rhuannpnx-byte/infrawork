import { useEffect, useRef, useState } from 'react'
import { lerOrigemArquivo, type OrigemArquivo } from '@/lib/exifArquivo'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Camera as CameraIcon,
  ChevronRight,
  Loader2,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { useIsAuthenticated, useSession } from '@/core/auth/SessionStore'
import {
  captureFrameFromVideo,
  openRearCamera,
  type CameraStream,
} from '@/core/camera/cameraStream'
import { cameraProvider } from '@/core/camera'
import {
  GPS_ACCURACY_MAX_METERS,
  GPS_ACCURACY_THRESHOLD_METERS,
  isAccurateEnough,
  isUsablePosition,
  watchCurrentPosition,
  type FixedPosition,
  type GeoResult,
} from '@/core/location/GeolocationProvider'
import { releaseWakeLock, requestScreenWakeLock } from '@/core/platform/wakeLock'
import { useCatalogo, useObra } from '@/core/db/daos'
import { PickerSheet } from '@/features/common/PickerSheet'
import { cn } from '@/lib/cn'
import { equipesDoEncarregado, temEquipesVinculadas } from '@/lib/equipes'
import { saveFoto } from '@/features/fotos/fotoRepo'

/**
 * FotosCaptureRoute — fluxo de foto numa ÚNICA tela com 2 modos:
 *
 *   1. 'live':  câmera ao vivo + botão shutter.
 *   2. 'form':  preview da foto JÁ COM watermark queimado + pickers (serviço,
 *               encarregado, equipe) + obs + GPS + botões "Refazer" / "Salvar".
 *
 * O blob fica em useState local — sem Zustand atravessando rotas, sem state
 * volátil sobrevivendo a navegação acidental.
 *
 * O watermark re-renderiza sempre que os metadados mudam (debounced 300ms).
 * O usuário vê em tempo real exatamente o que vai gravar.
 */
type Mode = 'live' | 'form'

/** Foto de um lançamento da sessão de produção: já sabe serviço, encarregado e equipe e fica ligada a ele. */
export interface ContextoFoto {
  producaoId: string
  servicoId: string
  servicoNome: string
  encarregadoId: string | null
  encarregadoNome: string | null
  equipeId: string | null
  equipeNome: string | null
}

export function FotosCaptureRoute() {
  const authed = useIsAuthenticated()
  const session = useSession()
  const navigate = useNavigate()
  const obra = useObra(session?.obraAtualId)
  const contexto = (useLocation().state as { foto?: ContextoFoto } | null)?.foto ?? null

  const [mode, setMode] = useState<Mode>('live')
  const [rawBlob, setRawBlob] = useState<Blob | null>(null)
  const [position, setPosition] = useState<FixedPosition | null>(null)
  const [geo, setGeo] = useState<GeoResult>({ status: 'pending' })
  // foto da galeria: data/GPS do próprio arquivo (não a hora e o lugar de agora)
  const [origem, setOrigem] = useState<OrigemArquivo | null>(null)
  // sem fix bom em 20 s (ou GPS negado/indisponível) a foto pode sair sem coordenadas
  const [semGps, setSemGps] = useState(false)

  // -------------------------------------------------------------------------
  //  Provider: native (Capacitor Camera plugin com correctOrientation=true)
  //  vs web (getUserMedia + frame capture do <video>). Native resolve
  //  orientação na fonte; web precisa fallback.
  // -------------------------------------------------------------------------
  const provider = cameraProvider()
  const isNativeCamera = provider.kind === 'native'

  // -------------------------------------------------------------------------
  //  MODE 'live' — câmera ao vivo (só pra provider=web)
  // -------------------------------------------------------------------------
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [stream, setStream] = useState<CameraStream | null>(null)
  const streamRef = useRef<CameraStream | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [shooting, setShooting] = useState(false)

  // GPS sempre ativo em mode=live (qualquer provider) — gate do botão shutter.
  useEffect(() => {
    if (!authed || mode !== 'live') return
    let cancelled = false

    const stopWatch = watchCurrentPosition((r) => {
      if (cancelled) return
      setGeo(r)
      if (r.status === 'ok' && r.position) setPosition(r.position)
    })

    // Pre-warm do chunk do WatermarkRenderer enquanto operador alinha a foto.
    void import('@/core/camera/WatermarkRenderer').catch(() => {})

    return () => {
      cancelled = true
      stopWatch()
    }
  }, [authed, mode])

  // Stream do <video> + wake lock — APENAS pro provider web (getUserMedia).
  // No native, a câmera é aberta sob demanda pelo Capacitor plugin; sem stream
  // contínuo, sem <video>, sem necessidade de wake lock (UI nativa cuida).
  useEffect(() => {
    if (!authed || mode !== 'live' || isNativeCamera) return
    let cancelled = false
    let wakeLock: Awaited<ReturnType<typeof requestScreenWakeLock>> = null

    void requestScreenWakeLock().then((w) => {
      if (cancelled) void releaseWakeLock(w)
      else wakeLock = w
    })

    openRearCamera()
      .then((s) => {
        if (cancelled) {
          s.stop()
          return
        }
        streamRef.current = s
        setStream(s)
        if (videoRef.current) videoRef.current.srcObject = s.stream
      })
      .catch((e) => {
        if (cancelled) return
        setCameraError(e instanceof Error ? e.message : 'Câmera indisponível')
      })

    return () => {
      cancelled = true
      void releaseWakeLock(wakeLock)
      // sair da tela (ou do modo câmera) desliga a câmera — antes ela ficava ligada em segundo plano
      streamRef.current?.stop()
      streamRef.current = null
    }
  }, [authed, mode, isNativeCamera])

  useEffect(() => {
    if (mode !== 'live') return
    if (geo.status === 'denied' || geo.status === 'unavailable') {
      setSemGps(true)
      return
    }
    const t = setTimeout(() => setSemGps(true), 20_000)
    return () => clearTimeout(t)
  }, [mode, geo.status])
  const podeFotografar = isUsablePosition(position) || semGps

  // Limpa stream quando sai do mode 'live'
  useEffect(() => {
    if (mode !== 'live') {
      stream?.stop()
      setStream(null)
    }
    return () => {
      stream?.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // a obra vem da sessão (síncrona); o registro da obra no Dexie pode estar carregando — não redirecionar por ele.
  if (!authed) return <Navigate to="/login" replace />
  if (session?.obraAtualId == null) return <Navigate to="/" replace />

  async function handleCapture() {
    if (!videoRef.current) return
    setShooting(true)
    try {
      const blob = await captureFrameFromVideo(videoRef.current)
      stream?.stop()
      setStream(null)
      setRawBlob(blob)
      setMode('form')
    } catch (e) {
      setCameraError(e instanceof Error ? e.message : 'Falha ao capturar')
    } finally {
      setShooting(false)
    }
  }

  // Captura via plugin nativo Capacitor Camera (Android). Abre UI nativa do
  // sistema — autofocus, flash, zoom, e orientação tudo corrigido na fonte
  // (correctOrientation=true em nativeCameraProvider.ts). Sem stream contínuo
  // no <video>, sem rotação manual, sem dor.
  async function handleNativeCapture() {
    if (provider.kind !== 'native') return
    setShooting(true)
    try {
      const photo = await provider.capture()
      setRawBlob(photo.blob)
      setMode('form')
    } catch (e) {
      // User pode ter cancelado a UI nativa — não tratar como erro fatal.
      const msg = e instanceof Error ? e.message : String(e)
      if (!/cancel/i.test(msg)) {
        setCameraError(msg)
      }
    } finally {
      setShooting(false)
    }
  }

  async function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const o = await lerOrigemArquivo(file)
    stream?.stop()
    setStream(null)
    setOrigem(o)
    setRawBlob(file)
    setMode('form')
  }

  function handleRetake() {
    setOrigem(null)
    setRawBlob(null)
    setMode('live')
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MODE 'live' — branch entre provider nativo (UI Android sistema) vs web
  // (stream getUserMedia + <video> + canvas).
  if (mode === 'live' && isNativeCamera) {
    const usable = isUsablePosition(position)
    return (
      <main className="grid h-svh grid-rows-[auto_1fr_auto] overflow-hidden bg-bg-base">
        <header className="flex items-center justify-between border-b border-border px-4 py-3 pl-safe pr-safe pt-safe-plus-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/fotos')}
            aria-label="Voltar"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-base font-semibold text-on-surface">Tirar foto</h1>
          <GeoBadge geo={geo} />
        </header>

        {/* Tela central de instrução — UI nativa abre sob demanda. */}
        <div className="flex flex-col items-center justify-center gap-6 p-6 text-center">
          <CameraIcon className="h-24 w-24 text-on-surface-dim" />
          <div>
            <p className="text-lg font-medium text-on-surface">Pronto pra tirar a foto</p>
            <p className="mt-1 text-sm text-on-surface-dim">
              A câmera nativa do Android abre ao tocar abaixo.
            </p>
          </div>
          {cameraError && <p className="text-sm text-bad">{cameraError}</p>}
          <GpsGateMessage geo={geo} position={position} semGps={semGps} />
        </div>

        <div className="border-t border-border px-4 py-3 pl-safe pr-safe pb-safe-plus-3">
          <Button
            variant="primary"
            size="lg"
            onClick={handleNativeCapture}
            disabled={!usable || shooting}
            className="w-full"
          >
            <CameraIcon className="h-5 w-5" />
            <span>{shooting ? 'Abrindo câmera…' : 'Tirar foto'}</span>
          </Button>
        </div>
      </main>
    )
  }

  if (mode === 'live') {
    return (
      // Grid 3-rows com `h-svh` (altura fixa do viewport) e overflow-hidden:
      // garante header + preview + footer sempre encaixados sem scroll. Antes
      // era `min-h-svh flex flex-col` com header absolute — em viewports curtas
      // o footer com shutter saía pra fora e o operador precisava scrollar.
      <main className="grid h-svh grid-rows-[auto_1fr_auto] overflow-hidden bg-black">
        <header className="relative z-10 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent p-3 pl-safe pr-safe pt-safe-plus-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/fotos')}
            aria-label="Voltar"
            className="text-white hover:bg-white/10"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <GeoBadge geo={geo} />
        </header>

        <div className="flex items-center justify-center overflow-hidden bg-black">
          {cameraError ? (
            <div className="p-6 text-center text-white">
              <p className="font-medium">Câmera indisponível</p>
              <p className="mt-2 text-sm opacity-80">{cameraError}</p>
              <p className="mt-3 text-xs opacity-60">
                Use o botão de upload abaixo para enviar uma foto da galeria.
              </p>
            </div>
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover"
            />
          )}
        </div>

        <div className="flex flex-col items-center gap-2 bg-black/90 px-6 py-3 pl-safe pr-safe pb-safe-plus-3">
          {/* GATE: shutter só libera com GPS abaixo de N metros de precisão.
              Operador vê motivo claro pra espera + accuracy em tempo real. */}
          <GpsGateMessage geo={geo} position={position} semGps={semGps} />
          <div className="flex w-full items-center justify-center gap-8">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-full bg-white/10 p-3 text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Enviar foto da galeria"
            >
              <Upload className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={handleCapture}
              disabled={!stream || shooting || !podeFotografar}
              className="relative h-16 w-16 rounded-full border-4 border-white disabled:cursor-not-allowed disabled:opacity-30"
              aria-label={podeFotografar ? 'Tirar foto' : 'Aguarde GPS'}
            >
              <span className="absolute inset-2 rounded-full bg-white" />
            </button>

            <div className="h-12 w-12 p-3" />
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => void handleFileInput(e)}
          className="hidden"
        />
      </main>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MODE 'form' — preview com watermark + metadata
  return (
    <FormMode
      rawBlob={rawBlob!}
      position={
        origem
          ? origem.lat != null && origem.lng != null
            ? { lat: origem.lat, lng: origem.lng, accuracy: 0, capturedAt: origem.data.getTime() }
            : null
          : semGps && !isUsablePosition(position)
            ? null
            : position
      }
      dataFoto={origem?.data ?? null}
      obraId={session!.obraAtualId!}
      obraCodigo={obra?.codigo ?? '—'}
      contexto={contexto}
      onRetake={handleRetake}
      onSaved={() => (contexto ? navigate(-1) : navigate('/fotos', { replace: true }))}
    />
  )
}

// ============================================================================
//  Sub-componente FormMode — separado pra ter ciclo de vida limpo (montado só
//  quando entra em 'form'; useEffects do watermark não correm em 'live')
// ============================================================================

interface FormModeProps {
  rawBlob: Blob
  position: FixedPosition | null
  /** data em que a foto foi tirada (galeria); sem valor = agora */
  dataFoto: Date | null
  obraId: string
  obraCodigo: string
  contexto: ContextoFoto | null
  onRetake: () => void
  onSaved: () => void
}

function FormMode({
  rawBlob,
  position,
  dataFoto,
  obraId,
  obraCodigo,
  contexto,
  onRetake,
  onSaved,
}: FormModeProps) {
  const [quando] = useState(() => dataFoto ?? new Date())
  const catalogo = useCatalogo(obraId)
  const servicos = catalogo?.servicos ?? []
  const encarregados = catalogo?.encarregados ?? []
  const todasEquipes = catalogo?.equipes ?? []

  const [servicoId, setServicoId] = useState<string | null>(contexto?.servicoId ?? null)
  const [servicoNome, setServicoNome] = useState<string | null>(contexto?.servicoNome ?? null)
  const [encarregadoId, setEncarregadoId] = useState<string | null>(contexto?.encarregadoId ?? null)
  const [encarregadoNome, setEncarregadoNome] = useState<string | null>(
    contexto?.encarregadoNome ?? null,
  )
  const [equipeId, setEquipeId] = useState<string | null>(contexto?.equipeId ?? null)
  const [equipeNome, setEquipeNome] = useState<string | null>(contexto?.equipeNome ?? null)
  const equipes = equipesDoEncarregado(todasEquipes, encarregadoId)
  const [obs, setObs] = useState('')

  const [picker, setPicker] = useState<'servico' | 'encarregado' | 'equipe' | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Preview state — APENAS useState (sem ref). Reset acontece no onRetake do pai
  // que desmonta FormMode, então não há bug de "stamped zerado durante render".
  const [stampedBlob, setStampedBlob] = useState<Blob | null>(null)
  const [stampedUrl, setStampedUrl] = useState<string | null>(null)
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null)
  const [rendering, setRendering] = useState(false)
  const [erroAoSalvar, setErroAoSalvar] = useState(false)
  const renderSeqRef = useRef(0)

  // Re-renderiza watermark sempre que metadados mudam (debounced)
  useEffect(() => {
    const seq = ++renderSeqRef.current
    setRendering(true)
    setError(null)

    const handle = setTimeout(async () => {
      try {
        const { applyWatermark } = await import('@/core/camera/WatermarkRenderer')
        const stamped = await applyWatermark({
          blob: rawBlob,
          data: formatBR(quando),
          quando,
          servico: servicoNome,
          encarregado: encarregadoNome,
          equipe: equipeNome,
          lat: position?.lat ?? null,
          lng: position?.lng ?? null,
          accuracy: position?.accuracy ?? null,
        })
        if (seq !== renderSeqRef.current) return // outdated
        setStampedBlob((prev) => prev ?? stamped.blob) // marca primeiro sucesso
        setStampedBlob(stamped.blob)
        setDims({ width: stamped.width, height: stamped.height })
        setStampedUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return URL.createObjectURL(stamped.blob)
        })
      } catch (e) {
        if (seq !== renderSeqRef.current) return
        console.error('[FormMode] watermark falhou:', e)
        setError(e instanceof Error ? e.message : 'Falha ao renderizar preview')
      } finally {
        if (seq === renderSeqRef.current) setRendering(false)
      }
    }, 300)

    return () => clearTimeout(handle)
  }, [rawBlob, servicoNome, encarregadoNome, equipeNome, position, quando])

  // Cleanup do URL ao desmontar
  useEffect(() => {
    return () => {
      if (stampedUrl) URL.revokeObjectURL(stampedUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const canSave = stampedBlob != null && !saving && !rendering

  async function handleSave() {
    if (!stampedBlob || !dims) return
    setSaving(true)
    setError(null)
    setErroAoSalvar(false)
    try {
      await saveFoto({
        obraId,
        obraCodigo,
        producaoId: contexto?.producaoId ?? null,
        servicoId,
        servicoNome,
        encarregadoId,
        encarregadoNome,
        equipeId,
        equipeNome,
        lat: position?.lat ?? null,
        lng: position?.lng ?? null,
        accuracy: position?.accuracy || null,
        capturedAt: quando.toISOString(),
        fileBlob: stampedBlob,
        width: dims.width,
        height: dims.height,
        obs: obs.trim() || null,
      })
      onSaved()
    } catch (e) {
      setErroAoSalvar(true)
      setError(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="flex min-h-svh flex-col bg-bg-base">
      <header className="sticky top-0 z-10 border-b border-border bg-bg-base/95 backdrop-blur pt-safe pl-safe pr-safe">
        <div className="flex items-center gap-2 px-2 py-3">
          <Button variant="ghost" size="icon" onClick={onRetake} aria-label="Refazer">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold text-on-surface">Pré-visualizar foto</h1>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* PREVIEW — foto JÁ COM watermark aplicado */}
        <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-black">
          {stampedUrl ? (
            <img
              src={stampedUrl}
              alt="Foto com marca d'água"
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-sm text-white">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>Aplicando marca d'água…</span>
            </div>
          )}
          {rendering && stampedUrl && (
            <div className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-1 text-xs text-white">
              <Loader2 className="h-3 w-3 animate-spin" />
              atualizando
            </div>
          )}
        </div>

        <div className="mx-auto max-w-2xl space-y-3 p-4">
          {error && (
            <div className="rounded-lg bg-bad/15 p-3 text-sm text-bad">
              <p className="font-medium">
                {erroAoSalvar ? 'Erro ao salvar' : 'Erro ao renderizar'}
              </p>
              <p className="mt-1 text-xs opacity-90">{error}</p>
              <Button variant="outline" size="sm" onClick={onRetake} className="mt-2">
                <RotateCcw className="mr-1 h-4 w-4" />
                Refazer foto
              </Button>
            </div>
          )}

          <p className="text-xs text-on-surface-dim">
            A foto será gravada exatamente como na pré-visualização acima. Mude os campos abaixo pra
            atualizar a marca d'água em tempo real.
          </p>

          <PickerField
            label="SERVIÇO"
            value={servicoNome ?? 'Selecionar…'}
            onClick={() => setPicker('servico')}
          />

          <PickerField
            label="ENCARREGADO"
            value={encarregadoNome ?? 'Selecionar…'}
            onClick={() => setPicker('encarregado')}
          />

          <PickerField
            label="EQUIPE"
            value={equipes.length === 0 ? 'Sem equipes na obra' : (equipeNome ?? 'Selecionar…')}
            onClick={() => setPicker('equipe')}
            disabled={equipes.length === 0}
            onClear={
              equipeId != null
                ? () => {
                    setEquipeId(null)
                    setEquipeNome(null)
                  }
                : undefined
            }
          />

          <div>
            <label className="text-xs font-medium uppercase text-on-surface-dim">Observações</label>
            <textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              rows={3}
              className={cn(
                'mt-1 w-full rounded-lg border border-border bg-surface-1 px-3 py-2',
                'text-on-surface placeholder:text-on-surface-muted',
                'focus-visible:border-accent focus-visible:outline-none',
              )}
              placeholder="Descreva a foto…"
            />
          </div>

          {position ? (
            <p className="text-xs text-on-surface-dim">
              GPS: {position.lat.toFixed(5)}, {position.lng.toFixed(5)} · ±
              {Math.round(position.accuracy)}m
            </p>
          ) : (
            <p className="text-xs text-warn">Sem GPS — a foto será enviada sem coordenadas.</p>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 flex gap-3 border-t border-border bg-bg-base/95 p-4 backdrop-blur pl-safe pr-safe pb-safe-plus-4">
        <Button variant="outline" size="lg" onClick={onRetake} className="flex-1">
          Refazer
        </Button>
        <Button
          variant="primary"
          size="lg"
          disabled={!canSave}
          onClick={handleSave}
          className="flex-1"
        >
          {saving ? 'Salvando…' : rendering ? 'Renderizando…' : 'Salvar foto'}
        </Button>
      </div>

      {picker === 'servico' && (
        <PickerSheet
          open
          title="Selecionar serviço"
          items={servicos}
          label={(s) => `${s.codigo} ${s.descricao}`}
          sublabel={(s) => s.unidade ?? '—'}
          onPick={(s) => {
            setServicoId(s.id)
            setServicoNome(s.descricao)
            setPicker(null)
          }}
          onDismiss={() => setPicker(null)}
          searchHint="Buscar serviço"
          emptyMessage="Sem serviços na obra"
        />
      )}

      {picker === 'encarregado' && (
        <PickerSheet
          open
          title="Selecionar encarregado"
          items={encarregados}
          label={(e) => (e.apelido ? `${e.nome} (${e.apelido})` : e.nome)}
          onPick={(e) => {
            setEncarregadoId(e.id)
            setEncarregadoNome(e.nome)
            const lista = equipesDoEncarregado(todasEquipes, e.id)
            if (temEquipesVinculadas(todasEquipes, e.id) && lista.length === 1) {
              setEquipeId(lista[0]!.id)
              setEquipeNome(lista[0]!.nome)
            } else if (equipeId && !lista.some((q) => q.id === equipeId)) {
              setEquipeId(null)
              setEquipeNome(null)
            }
            setPicker(null)
          }}
          onDismiss={() => setPicker(null)}
          searchHint="Buscar encarregado"
          emptyMessage="Sem encarregados na obra"
        />
      )}

      {picker === 'equipe' && (
        <PickerSheet
          open
          title="Selecionar equipe"
          items={equipes}
          label={(e) => e.nome}
          onPick={(e) => {
            setEquipeId(e.id)
            setEquipeNome(e.nome)
            setPicker(null)
          }}
          onDismiss={() => setPicker(null)}
          searchHint="Buscar equipe"
          emptyMessage="Sem equipes na obra"
        />
      )}
    </main>
  )
}

// ============================================================================
//  Primitivos
// ============================================================================

function GeoBadge({ geo }: { geo: GeoResult }) {
  const acc = geo.position?.accuracy
  const isStaleOk = geo.status === 'ok' && geo.stale
  const accurate = acc != null && acc <= GPS_ACCURACY_THRESHOLD_METERS
  const label = isStaleOk
    ? `GPS cache ±${Math.round(acc!)}m`
    : geo.status === 'ok'
      ? `GPS ±${Math.round(acc!)}m${accurate ? ' ✓' : ''}`
      : geo.status === 'pending'
        ? 'Buscando GPS…'
        : geo.status === 'denied'
          ? 'GPS negado'
          : 'Sem GPS'
  const tone = accurate
    ? 'bg-ok/80 text-white'
    : geo.status === 'ok'
      ? 'bg-warn/80 text-bg-base'
      : geo.status === 'pending'
        ? 'bg-white/20 text-white'
        : 'bg-bad/80 text-white'

  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${tone}`}>
      {label}
    </span>
  )
}

/**
 * Mensagem acima do shutter conforme estado do GPS:
 *  - Sem fix ou erro → bloqueia + mensagem amarela
 *  - 50-150m → libera + aviso "precisão reduzida ±Xm"
 *  - ≤ 50m → some (operador pronto)
 */
function GpsGateMessage({
  geo,
  position,
  semGps,
}: {
  geo: GeoResult
  position: FixedPosition | null
  semGps: boolean
}) {
  if (isAccurateEnough(position)) return null
  if (semGps && !isUsablePosition(position)) {
    return (
      <p className="max-w-xs text-center text-xs text-warn">
        {geo.status === 'denied'
          ? 'GPS negado — a foto sai sem coordenadas (habilite a localização nas permissões).'
          : 'Sem sinal de GPS — a foto sai sem coordenadas.'}
      </p>
    )
  }

  // Tem fix utilizável (50-150m): aviso amarelo + libera shutter.
  if (isUsablePosition(position)) {
    return (
      <p className="max-w-xs text-center text-xs text-warn">
        Precisão reduzida — ±{Math.round(position!.accuracy)}m (ideal ≤
        {GPS_ACCURACY_THRESHOLD_METERS}m)
      </p>
    )
  }

  let label: string
  if (geo.status === 'denied') {
    label = 'GPS negado — habilite localização nas permissões do app.'
  } else if (geo.status === 'unavailable') {
    label = 'GPS indisponível neste dispositivo.'
  } else if (position == null) {
    label = 'Aguardando GPS… vá pra área aberta pra acelerar.'
  } else {
    label = `Aguardando GPS — atual ±${Math.round(position.accuracy)}m, máx ${GPS_ACCURACY_MAX_METERS}m`
  }
  return <p className="max-w-xs text-center text-xs text-warn">{label}</p>
}

function PickerField({
  label,
  value,
  onClick,
  onClear,
  required,
  disabled,
}: {
  label: string
  value: string
  onClick: () => void
  onClear?: () => void
  required?: boolean
  disabled?: boolean
}) {
  return (
    <div>
      <label className="text-xs font-medium uppercase text-on-surface-dim">{label}</label>
      <div className="mt-1 flex items-stretch gap-2">
        <button
          type="button"
          onClick={disabled ? undefined : onClick}
          disabled={disabled}
          className={cn(
            'flex-1 rounded-lg border bg-surface-1 px-3 text-left',
            'flex min-h-touch items-center justify-between transition-colors',
            disabled
              ? 'cursor-not-allowed border-border opacity-50'
              : required
                ? 'border-warn/60 hover:border-warn'
                : 'border-border hover:border-accent/60',
          )}
        >
          <span className="truncate text-on-surface">{value}</span>
          {!disabled && <ChevronRight className="h-4 w-4 flex-shrink-0 text-on-surface-dim" />}
        </button>
        {onClear && !disabled && (
          <Button variant="ghost" size="icon" onClick={onClear} aria-label="Limpar">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

function formatBR(d: Date): string {
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Wizard 5-step pra importar polilinha KMZ/KML em um trecho.
//
// Steps:
//   1) Upload (drag-drop + buscar arquivo)
//   2) Sentido (preview no mapa com seta animada + botao inverter)
//   3) Sistema de unidades (km/estaca-20m/metro/custom)
//   4) Valor inicial + cor
//   5) Preview final com TODOS marcadores + salvar
//
// Quando trecho ja tem geometria, abre em modo edit (step 2 com a polilinha
// pre-carregada). Botao "Trocar arquivo" volta pro step 1.
//
// Persistencia: um unico UPDATE no fim do step 5 com TODOS os campos
// (geometry_geojson, bounds, comprimento, sentido, unidade, custom_label/divisor,
// valor_inicial, cor, importado_em). Atomico — sem half-state no DB.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode
} from 'react'
import { toast } from 'sonner'
import { Upload, ArrowLeftRight, Map } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { parseKmzOrKml, type ParsedKmlResult } from '@/lib/kml/parse'
import { formatMarcadorCompacto, type TrechoCtx } from '@/lib/format/posicao'
import { MapaTrecho, type MapaTrechoMarcador } from '@/features/planejamento/components/MapaTrecho'
import { useSalvarGeometriaTrecho } from '@/features/planejamento/hooks/trechos'
import {
  TRECHO_CORES_PADRAO,
  type ObraTrecho,
  type UnidadeEspacoPadrao
} from '@/types/gerencial'

// ─── Tipos auxiliares ───────────────────────────────────────────────────
type Unidade = 'km' | 'm' | 'estaca' | 'custom'
type Step = 1 | 2 | 3 | 4 | 5

const UNIDADE_DIVISOR: Record<Exclude<Unidade, 'custom'>, number> = {
  km: 1000,
  estaca: 20,
  m: 1
}

const UNIDADE_LABEL: Record<Exclude<Unidade, 'custom'>, string> = {
  km: 'km',
  estaca: 'EST',
  m: 'm'
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Trecho a editar. */
  trecho: ObraTrecho | null
  /**
   * Modo de entrada:
   *   'novo'   — comeca no step 1 (upload). Default.
   *   'trocar' — substitui geometria existente: step 1 (upload), preserva cor.
   *   'editar' — edita config (unidade/cor/valor inicial) sem trocar arquivo:
   *              entra no step 3, Voltar dali fecha.
   */
  modo?: 'novo' | 'trocar' | 'editar'
}

export function ImportarKmlTrechoDialog({
  open,
  onOpenChange,
  trecho,
  modo = 'novo'
}: Props): ReactNode {
  const salvar = useSalvarGeometriaTrecho()

  // ─── Estado do wizard ──────────────────────────────────────────────────
  const [step, setStep] = useState<Step>(1)
  const [parsed, setParsed] = useState<ParsedKmlResult | null>(null)
  // Desacoplado: orientação GEOMÉTRICA (reverte as coords / seta do mapa) é
  // independente da NUMERAÇÃO do estaqueamento (crescente/decrescente). A
  // numeração vira geometry_sentido ('natural'/'invertido'); a orientação é
  // aplicada nas coordenadas salvas.
  const [coordsInvertidas, setCoordsInvertidas] = useState(false)
  const [numeracao, setNumeracao] = useState<'crescente' | 'decrescente'>('crescente')
  const [unidade, setUnidade] = useState<Unidade>('km')
  const [customLabel, setCustomLabel] = useState('')
  const [customDivisor, setCustomDivisor] = useState<number>(25)
  const [valorInicial, setValorInicial] = useState<number>(0)
  const [cor, setCor] = useState<string>(TRECHO_CORES_PADRAO[0])
  const [error, setError] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)

  // ─── Pre-carrega conforme modo ─────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const temGeom =
      !!trecho?.geometry_geojson && !!trecho.geometry_bounds && trecho.geometry_comprimento_m != null

    if (modo === 'editar' && trecho && temGeom) {
      setParsed({
        geometry: trecho.geometry_geojson!,
        bounds: trecho.geometry_bounds!,
        comprimentoM: Number(trecho.geometry_comprimento_m),
        totalLineStrings: 1
      })
      setNumeracao(trecho.geometry_sentido === 'invertido' ? 'decrescente' : 'crescente')
      // Coords já estão salvas com a orientação atual; não re-reverter no edit.
      setCoordsInvertidas(false)
      setUnidade(trecho.unidade_espaco_padrao as Unidade)
      setCustomLabel(trecho.unidade_custom_label ?? '')
      setCustomDivisor(trecho.unidade_custom_divisor_m ?? 25)
      setValorInicial(Number(trecho.marcador_valor_inicial))
      setCor(trecho.cor)
      // Modo edicao da config: pula upload/orientação (preserva geometria intacta).
      setStep(3)
    } else if (trecho) {
      // Modo 'novo' ou 'trocar' — comeca no upload. Preserva cor/unidade atuais
      // como defaults se houver.
      setCor(trecho.cor)
      setUnidade(trecho.unidade_espaco_padrao as Unidade)
      setCustomLabel(trecho.unidade_custom_label ?? '')
      setCustomDivisor(trecho.unidade_custom_divisor_m ?? 25)
      setValorInicial(Number(trecho.marcador_valor_inicial))
      setNumeracao(trecho.geometry_sentido === 'invertido' ? 'decrescente' : 'crescente')
      setParsed(null)
      setCoordsInvertidas(false)
      setStep(1)
    } else {
      setStep(1)
    }
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trecho?.id, modo])

  function reset(): void {
    setStep(1)
    setParsed(null)
    setCoordsInvertidas(false)
    setNumeracao('crescente')
    setError(null)
  }

  // geometry_sentido derivado da numeração (independente da orientação geométrica).
  const sentidoNumeracao: 'natural' | 'invertido' =
    numeracao === 'decrescente' ? 'invertido' : 'natural'

  // ─── Geometria com orientação aplicada ──────────────────────────────────
  const geometryDisplay = useMemo<GeoJSON.LineString | null>(() => {
    if (!parsed) return null
    if (!coordsInvertidas) return parsed.geometry
    return {
      type: 'LineString',
      coordinates: [...parsed.geometry.coordinates].reverse()
    }
  }, [parsed, coordsInvertidas])

  // ─── Marcadores derivados ──────────────────────────────────────────────
  const divisorM = unidade === 'custom' ? customDivisor : UNIDADE_DIVISOR[unidade]
  const labelUnidade = unidade === 'custom' ? customLabel.trim() || 'ref' : UNIDADE_LABEL[unidade]

  const trechoCtx = useMemo<TrechoCtx>(
    () => ({
      unidade_espaco_padrao: unidade,
      unidade_custom_label: customLabel.trim() || null,
      unidade_custom_divisor_m: unidade === 'custom' ? customDivisor : null,
      marcador_valor_inicial: valorInicial,
      geometry_sentido: sentidoNumeracao,
      geometry_comprimento_m: parsed?.comprimentoM ?? null
    }),
    [unidade, customLabel, customDivisor, valorInicial, sentidoNumeracao, parsed]
  )

  const marcadores = useMemo<MapaTrechoMarcador[]>(() => {
    if (!parsed || divisorM <= 0) return []
    const out: MapaTrechoMarcador[] = []
    for (let pos = 0; pos <= parsed.comprimentoM; pos += divisorM) {
      // Sentido-aware: 'invertido' decresce a partir do valor inicial — preview
      // bate com o que a cronograma/marcha-tempo mostram depois de salvar.
      out.push({ posicaoM: pos, label: formatMarcadorCompacto(pos, trechoCtx) })
    }
    return out
  }, [parsed, divisorM, trechoCtx])

  // ─── File handling ─────────────────────────────────────────────────────
  async function processarArquivo(file: File): Promise<void> {
    setError(null)
    setParsing(true)
    try {
      const r = await parseKmzOrKml(file)
      setParsed(r)
      setCoordsInvertidas(false)
      setStep(2)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setParsing(false)
    }
  }

  // ─── Salvar ────────────────────────────────────────────────────────────
  async function commitSalvar(): Promise<void> {
    if (!trecho || !parsed || !geometryDisplay) return
    setError(null)
    try {
      await salvar.mutateAsync({
        id: trecho.id,
        obra_id: trecho.obra_id,
        cor,
        unidade_espaco_padrao: unidade as UnidadeEspacoPadrao,
        unidade_custom_label: unidade === 'custom' ? customLabel.trim() : null,
        unidade_custom_divisor_m: unidade === 'custom' ? customDivisor : null,
        marcador_valor_inicial: valorInicial,
        geometry_geojson: geometryDisplay,
        geometry_bounds: parsed.bounds,
        geometry_comprimento_m: parsed.comprimentoM,
        geometry_sentido: sentidoNumeracao,
        geometry_importado_em: new Date().toISOString()
      })
      toast.success('Mapa do trecho salvo.')
      reset()
      onOpenChange(false)
    } catch (e) {
      setError('Falha ao salvar: ' + (e as Error).message)
    }
  }

  // ─── Validacao step a step ─────────────────────────────────────────────
  const podeAvancar3 = unidade !== 'custom' || (customLabel.trim().length > 0 && customDivisor > 0)
  const podeAvancar4 = Number.isFinite(valorInicial) && valorInicial >= 0 && !!cor

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      size="xl"
      disableDismiss={parsing || salvar.isPending}
    >
      <DialogHeader>
        <DialogTitle>
          {modo === 'editar'
            ? `Configuração do mapa — ${trecho?.nome ?? ''}`
            : modo === 'trocar'
              ? `Substituir polilinha — ${trecho?.nome ?? ''}`
              : trecho
                ? `Mapa do trecho — ${trecho.nome}`
                : 'Importar polilinha KMZ/KML'}
          <span className="ml-2 text-2xs font-mono text-text-dim">
            {modo === 'editar' ? `Passo ${step - 2}/3` : `Passo ${step}/5`}
          </span>
        </DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={error} />

        {step === 1 ? (
          <UploadStep parsing={parsing} onFile={processarArquivo} />
        ) : null}

        {step === 2 && geometryDisplay && parsed ? (
          <SentidoStep
            geometry={geometryDisplay}
            cor={cor}
            comprimentoM={parsed.comprimentoM}
            totalLineStrings={parsed.totalLineStrings}
            coordsInvertidas={coordsInvertidas}
            onInverter={() => setCoordsInvertidas((v) => !v)}
            onTrocarArquivo={() => setStep(1)}
          />
        ) : null}

        {step === 3 ? (
          <UnidadeStep
            unidade={unidade}
            setUnidade={setUnidade}
            customLabel={customLabel}
            setCustomLabel={setCustomLabel}
            customDivisor={customDivisor}
            setCustomDivisor={setCustomDivisor}
          />
        ) : null}

        {step === 4 ? (
          <ValorInicialCorStep
            valorInicial={valorInicial}
            setValorInicial={setValorInicial}
            cor={cor}
            setCor={setCor}
            labelUnidade={labelUnidade}
            divisorM={divisorM}
            numeracao={numeracao}
            setNumeracao={setNumeracao}
          />
        ) : null}

        {step === 5 && geometryDisplay && parsed ? (
          <PreviewFinalStep
            geometry={geometryDisplay}
            cor={cor}
            marcadores={marcadores}
            comprimentoM={parsed.comprimentoM}
            numeracao={numeracao}
            coordsInvertidas={coordsInvertidas}
            labelUnidade={labelUnidade}
          />
        ) : null}
      </DialogBody>
      <DialogFooter>
        {step > 1 && !(modo === 'editar' && step === 3) ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={parsing || salvar.isPending}
            onClick={() => setStep((s) => (s - 1) as Step)}
          >
            Voltar
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={parsing}
          >
            Cancelar
          </Button>
        )}
        {step < 5 ? (
          <Button
            variant="default"
            size="sm"
            disabled={
              (step === 1 && !parsed) ||
              (step === 3 && !podeAvancar3) ||
              (step === 4 && !podeAvancar4) ||
              parsing
            }
            onClick={() => setStep((s) => (s + 1) as Step)}
          >
            Continuar
          </Button>
        ) : (
          <Button
            variant="default"
            size="sm"
            disabled={salvar.isPending}
            onClick={commitSalvar}
          >
            {salvar.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  )
}

// ─── Step 1: Upload ──────────────────────────────────────────────────────
function UploadStep({
  parsing,
  onFile
}: {
  parsing: boolean
  onFile: (f: File) => void | Promise<void>
}): ReactNode {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) void onFile(f)
  }

  return (
    <div className="space-y-3">
      <div
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        className={`border-2 border-dashed rounded p-8 text-center transition-colors ${
          dragOver ? 'border-accent bg-accent/5' : 'border-border bg-bg/40'
        }`}
      >
        <Upload size={32} className="mx-auto mb-2 text-text-dim" />
        <div className="text-sm text-text mb-1">
          Arraste o arquivo KMZ ou KML aqui
        </div>
        <div className="text-2xs text-text-dim mb-3 font-mono">
          ou clique abaixo pra buscar no dispositivo
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
          disabled={parsing}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onFile(f)
            e.target.value = ''
          }}
          className="hidden"
        />
        <Button
          variant="default"
          size="sm"
          disabled={parsing}
          onClick={() => inputRef.current?.click()}
        >
          {parsing ? 'Processando…' : 'Buscar arquivo'}
        </Button>
      </div>
      <div className="text-2xs text-text-dim font-mono leading-relaxed">
        Aceita .kml (texto) ou .kmz (zip com .kml interno). Tamanho máximo 10 MB.
        <br />
        Se o arquivo tiver mais de uma polilinha, a primeira será usada (aviso aparece).
      </div>
    </div>
  )
}

// ─── Step 2: Orientação geométrica da polilinha ──────────────────────────
// Só inverte as COORDENADAS (a seta verde→vermelho / qual ponta é o começo).
// NÃO mexe na numeração crescente/decrescente — isso é escolhido no Passo 4.
function SentidoStep({
  geometry,
  cor,
  comprimentoM,
  totalLineStrings,
  coordsInvertidas,
  onInverter,
  onTrocarArquivo
}: {
  geometry: GeoJSON.LineString
  cor: string
  comprimentoM: number
  totalLineStrings: number
  coordsInvertidas: boolean
  onInverter: () => void
  onTrocarArquivo: () => void
}): ReactNode {
  return (
    <div className="space-y-3">
      {totalLineStrings > 1 ? (
        <div className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-2xs font-mono text-warning">
          Detectadas {totalLineStrings} polilinhas no arquivo. Usando a primeira
          ({geometry.coordinates.length} pontos, {(comprimentoM / 1000).toFixed(2)} km).
        </div>
      ) : null}
      <div className="text-2xs text-text-dim font-mono leading-relaxed">
        A seta animada mostra a orientação da polilinha (do <strong className="text-success">INÍCIO</strong>{' '}
        verde até o <strong className="text-danger">FIM</strong> vermelho). Inverta se o começo do
        traçado deveria ser a outra ponta. Isso afeta só a geometria — se as estacas/km{' '}
        <em>crescem ou decrescem</em> você define no Passo 4.
      </div>
      <MapaTrecho geometry={geometry} cor={cor} animarSeta interactive altura={400} />
      <div className="flex items-center justify-between text-2xs font-mono">
        <div className="text-text-dim">
          Orientação:{' '}
          <span className="text-text">
            {coordsInvertidas ? 'INVERTIDA (do arquivo)' : 'NATURAL (do arquivo)'}
          </span>{' '}
          · {geometry.coordinates.length} pontos · {(comprimentoM / 1000).toFixed(2)} km
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onTrocarArquivo}>
            Trocar arquivo
          </Button>
          <Button variant="ghost" size="sm" onClick={onInverter}>
            <ArrowLeftRight size={11} /> Inverter orientação
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Step 3: Unidade ─────────────────────────────────────────────────────
function UnidadeStep({
  unidade,
  setUnidade,
  customLabel,
  setCustomLabel,
  customDivisor,
  setCustomDivisor
}: {
  unidade: Unidade
  setUnidade: (u: Unidade) => void
  customLabel: string
  setCustomLabel: (s: string) => void
  customDivisor: number
  setCustomDivisor: (n: number) => void
}): ReactNode {
  const opcoes: Array<{ value: Unidade; titulo: string; desc: string }> = [
    { value: 'km', titulo: 'Quilômetro (km)', desc: '1 marcador a cada 1000 m. Padrão rodoviário.' },
    { value: 'estaca', titulo: 'Estaca (20 m)', desc: '1 marcador a cada 20 m. Topografia/obra detalhada.' },
    { value: 'm', titulo: 'Metro (m)', desc: '1 marcador a cada metro. Use só pra trechos curtos.' },
    { value: 'custom', titulo: 'Personalizado', desc: 'Define seu próprio divisor (m) e label.' }
  ]

  return (
    <div className="space-y-3">
      <div className="text-2xs text-text-dim font-mono">
        Escolha a unidade dos marcadores que serão gerados ao longo da polilinha.
      </div>
      <div className="grid grid-cols-2 gap-2">
        {opcoes.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setUnidade(o.value)}
            className={`text-left rounded border p-3 transition-colors ${
              unidade === o.value
                ? 'border-accent bg-accent/10'
                : 'border-border bg-bg-panel hover:border-border-strong'
            }`}
          >
            <div className="text-xs font-medium text-text">{o.titulo}</div>
            <div className="text-2xs font-mono text-text-dim mt-1">{o.desc}</div>
          </button>
        ))}
      </div>
      {unidade === 'custom' ? (
        <div className="grid grid-cols-2 gap-3 rounded border border-accent/30 bg-accent/5 p-3">
          <div>
            <Label htmlFor="custom-label">Label da unidade</Label>
            <Input
              id="custom-label"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              placeholder="Ex: ref, ponto, vão"
              maxLength={20}
            />
          </div>
          <div>
            <Label htmlFor="custom-divisor">Divisor (metros por unidade)</Label>
            <Input
              id="custom-divisor"
              type="number"
              min="0.1"
              step="0.1"
              value={customDivisor}
              onChange={(e) => setCustomDivisor(Number(e.target.value))}
              placeholder="Ex: 25"
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ─── Step 4: Valor inicial + cor ─────────────────────────────────────────
function ValorInicialCorStep({
  valorInicial,
  setValorInicial,
  cor,
  setCor,
  labelUnidade,
  divisorM,
  numeracao,
  setNumeracao
}: {
  valorInicial: number
  setValorInicial: (n: number) => void
  cor: string
  setCor: (c: string) => void
  labelUnidade: string
  divisorM: number
  numeracao: 'crescente' | 'decrescente'
  setNumeracao: (n: 'crescente' | 'decrescente') => void
}): ReactNode {
  // Preview dos 4 primeiros marcadores. 'decrescente' baixa a partir do inicial.
  const preview = [0, 1, 2, 3].map((i) => {
    const valor = numeracao === 'decrescente' ? valorInicial - i : valorInicial + i
    const fmt = Number.isInteger(valor) ? String(valor) : valor.toFixed(2)
    return `${labelUnidade} ${fmt}`
  })

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="valor-inicial">Valor inicial no início da polilinha</Label>
        <Input
          id="valor-inicial"
          type="number"
          step="0.01"
          min="0"
          value={valorInicial}
          onChange={(e) => setValorInicial(Number(e.target.value))}
        />
        <div className="text-2xs text-text-dim mt-1 font-mono leading-relaxed">
          Se o trecho começa no &quot;{labelUnidade} 5&quot;, escreva 5. Marcadores subsequentes serão
          gerados a cada {divisorM} m (= 1 unidade).
        </div>
      </div>

      <div>
        <Label>Numeração ao longo do trecho</Label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          {(['crescente', 'decrescente'] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setNumeracao(opt)}
              className={`text-left rounded border p-2.5 transition-colors ${
                numeracao === opt
                  ? 'border-accent bg-accent/10'
                  : 'border-border bg-bg-panel hover:border-border-strong'
              }`}
            >
              <div className="text-xs font-medium text-text">
                {opt === 'crescente' ? 'Crescente ↑' : 'Decrescente ↓'}
              </div>
              <div className="text-2xs font-mono text-text-dim mt-0.5">
                {opt === 'crescente'
                  ? `${labelUnidade} ${valorInicial} → maior`
                  : `${labelUnidade} ${valorInicial} → menor`}
              </div>
            </button>
          ))}
        </div>
        <div className="text-2xs text-text-dim mt-1 font-mono leading-relaxed">
          Define se a estaca/km aumenta ou diminui ao avançar no traçado. Independente da
          orientação da polilinha (Passo 2).
        </div>
      </div>

      <div>
        <Label>Preview dos primeiros marcadores</Label>
        <div className="font-mono text-xs text-text bg-bg-panel rounded border border-border px-3 py-2">
          {preview.join(' · ')} · …
        </div>
      </div>

      <div>
        <Label>Cor do trecho</Label>
        <div className="grid grid-cols-8 gap-2 mt-1">
          {TRECHO_CORES_PADRAO.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCor(c)}
              className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${
                c === cor ? 'border-text scale-110' : 'border-border'
              }`}
              style={{ background: c }}
              aria-label={`Cor ${c}`}
            />
          ))}
        </div>
        <div className="text-2xs text-text-dim mt-1 font-mono">
          Usada nas visualizações multi-trecho pra diferenciar este trecho dos outros.
        </div>
      </div>
    </div>
  )
}

// ─── Step 5: Preview final ───────────────────────────────────────────────
function PreviewFinalStep({
  geometry,
  cor,
  marcadores,
  comprimentoM,
  numeracao,
  coordsInvertidas,
  labelUnidade
}: {
  geometry: GeoJSON.LineString
  cor: string
  marcadores: MapaTrechoMarcador[]
  comprimentoM: number
  numeracao: 'crescente' | 'decrescente'
  coordsInvertidas: boolean
  labelUnidade: string
}): ReactNode {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-2xs font-mono text-text-dim">
        <Map size={12} />
        <span>
          <strong className="text-text">{(comprimentoM / 1000).toFixed(2)} km</strong> ·{' '}
          <strong className="text-text">{marcadores.length}</strong> marcadores ({labelUnidade}) ·
          numeração <strong className="text-text">{numeracao}</strong> · orientação{' '}
          <strong className="text-text">{coordsInvertidas ? 'invertida' : 'natural'}</strong>
        </span>
      </div>
      <MapaTrecho
        geometry={geometry}
        cor={cor}
        marcadores={marcadores}
        animarSeta={false}
        interactive
        altura={400}
      />
      <div className="text-2xs text-text-dim font-mono leading-relaxed">
        Clique em <em>Salvar</em> pra persistir. As tarefas existentes no trecho não são
        afetadas — geometria é metadado de visualização.
      </div>
    </div>
  )
}

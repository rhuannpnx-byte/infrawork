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

import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Upload, ArrowLeftRight, Map } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { parseKmzOrKml, type ParsedKmlResult } from '@/lib/kml/parse'
import { formatMarcadorCompacto, type TrechoCtx } from '@/lib/format/posicao'
import { MapaTrecho, type MapaTrechoMarcador } from '@/features/planejamento/components/MapaTrecho'
import { useSalvarGeometriaTrecho } from '@/features/planejamento/hooks/trechos'
import { TRECHO_CORES_PADRAO, type ObraTrecho, type UnidadeEspacoPadrao } from '@/types/gerencial'

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

const km = (m: number): string =>
  (m / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const OPCAO =
  'text-left rounded border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
const opcaoCor = (ativa: boolean): string =>
  ativa ? 'border-accent bg-accent/10' : 'border-border-strong bg-bg-panel hover:bg-bg-hover'

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
  // erros do passo aparecem nos campos depois de tentar continuar
  const [tentouPasso, setTentouPasso] = useState(false)

  // ─── Pre-carrega conforme modo ─────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const temGeom =
      !!trecho?.geometry_geojson &&
      !!trecho.geometry_bounds &&
      trecho.geometry_comprimento_m != null

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
    setTentouPasso(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trecho?.id, modo])

  function reset(): void {
    setStep(1)
    setParsed(null)
    setCoordsInvertidas(false)
    setNumeracao('crescente')
    setError(null)
    setTentouPasso(false)
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
      setError(`Não foi possível ler o arquivo. ${(e as Error).message}`)
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
      toast.success('Mapa do eixo salvo.')
      reset()
      onOpenChange(false)
    } catch (e) {
      setError(`Não foi possível salvar o mapa. ${(e as Error).message}`)
    }
  }

  // ─── Validacao step a step ─────────────────────────────────────────────
  const podeAvancar3 = unidade !== 'custom' || (customLabel.trim().length > 0 && customDivisor > 0)
  const podeAvancar4 = Number.isFinite(valorInicial) && valorInicial >= 0 && !!cor

  const totalPassos = modo === 'editar' ? 3 : 5
  const passoAtual = modo === 'editar' ? step - 2 : step

  function continuar(): void {
    if ((step === 3 && !podeAvancar3) || (step === 4 && !podeAvancar4)) {
      setTentouPasso(true)
      return
    }
    setTentouPasso(false)
    setStep((s) => (s + 1) as Step)
  }

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
            ? 'Configuração do mapa'
            : modo === 'trocar'
              ? 'Trocar o arquivo do mapa'
              : 'Vincular mapa ao eixo'}
        </DialogTitle>
        <DialogDescription>
          {trecho ? `${trecho.nome} · ` : ''}Passo {passoAtual} de {totalPassos}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={error} />

        {step === 1 ? <UploadStep parsing={parsing} onFile={processarArquivo} /> : null}

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
            mostrarErros={tentouPasso}
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
            mostrarErros={tentouPasso}
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
            variant="secondary"
            disabled={parsing || salvar.isPending}
            onClick={() => {
              setTentouPasso(false)
              setStep((s) => (s - 1) as Step)
            }}
          >
            Voltar
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={parsing}>
            Cancelar
          </Button>
        )}
        {step < 5 ? (
          <Button
            variant="default"
            disabled={(step === 1 && !parsed) || parsing}
            title={step === 1 && !parsed ? 'Escolha um arquivo para continuar' : undefined}
            onClick={continuar}
          >
            Continuar
          </Button>
        ) : (
          <Button variant="default" disabled={salvar.isPending} onClick={commitSalvar}>
            {salvar.isPending ? 'Salvando…' : 'Salvar mapa'}
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
          dragOver ? 'border-accent bg-accent/5' : 'border-border-strong bg-bg/40'
        }`}
      >
        <Upload size={32} className="mx-auto mb-2 text-text-dim" aria-hidden />
        <div className="mb-1 text-md font-medium text-text">
          Arraste o arquivo KMZ ou KML para cá
        </div>
        <div className="mb-3 text-sm text-text-muted">ou escolha o arquivo no computador</div>
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
          aria-label="Arquivo KMZ ou KML"
        />
        <Button variant="default" disabled={parsing} onClick={() => inputRef.current?.click()}>
          {parsing ? 'Lendo o arquivo…' : 'Escolher arquivo'}
        </Button>
      </div>
      <p className="text-sm text-text-muted">
        Aceita arquivo .kml ou .kmz de até 10 MB. Se houver mais de uma polilinha, o sistema usa a
        primeira e avisa.
      </p>
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
        <div
          role="status"
          className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-text"
        >
          O arquivo tem {totalLineStrings} polilinhas. O sistema usou a primeira, com{' '}
          {geometry.coordinates.length.toLocaleString('pt-BR')} pontos e {km(comprimentoM)} km.
        </div>
      ) : null}
      <p className="text-sm text-text-muted">
        A seta mostra a orientação da polilinha, do <strong className="text-text">início</strong>{' '}
        (verde) ao <strong className="text-text">fim</strong> (vermelho). Inverta se o começo do
        traçado for a outra ponta. Isso muda só o desenho: se as estacas crescem ou decrescem, você
        define no passo 4.
      </p>
      <MapaTrecho geometry={geometry} cor={cor} animarSeta interactive altura={400} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="tabular text-text-muted">
          Orientação:{' '}
          <span className="font-medium text-text">
            {coordsInvertidas ? 'invertida em relação ao arquivo' : 'como no arquivo'}
          </span>
          , {geometry.coordinates.length.toLocaleString('pt-BR')} pontos, {km(comprimentoM)} km
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onTrocarArquivo}>
            Trocar arquivo
          </Button>
          <Button variant="secondary" size="sm" onClick={onInverter}>
            <ArrowLeftRight size={12} /> Inverter orientação
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
  setCustomDivisor,
  mostrarErros
}: {
  unidade: Unidade
  setUnidade: (u: Unidade) => void
  customLabel: string
  setCustomLabel: (s: string) => void
  customDivisor: number
  setCustomDivisor: (n: number) => void
  mostrarErros: boolean
}): ReactNode {
  const opcoes: Array<{ value: Unidade; titulo: string; desc: string }> = [
    {
      value: 'km',
      titulo: 'Quilômetro (km)',
      desc: 'Um marcador a cada 1.000 m. É o padrão rodoviário.'
    },
    {
      value: 'estaca',
      titulo: 'Estaca (20 m)',
      desc: 'Um marcador a cada 20 m. Para topografia e obra detalhada.'
    },
    {
      value: 'm',
      titulo: 'Metro (m)',
      desc: 'Um marcador a cada metro. Use só em eixo curto.'
    },
    {
      value: 'custom',
      titulo: 'Personalizada',
      desc: 'Você define o nome da unidade e quantos metros ela vale.'
    }
  ]

  return (
    <div className="space-y-3">
      <p id="kml-unidade-rotulo" className="text-sm text-text-muted">
        Escolha a unidade dos marcadores ao longo do eixo.
      </p>
      <div
        className="grid grid-cols-2 gap-2"
        role="radiogroup"
        aria-labelledby="kml-unidade-rotulo"
      >
        {opcoes.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={unidade === o.value}
            onClick={() => setUnidade(o.value)}
            className={cn(OPCAO, opcaoCor(unidade === o.value))}
          >
            <div className="text-sm font-medium text-text">{o.titulo}</div>
            <div className="mt-0.5 text-sm text-text-muted">{o.desc}</div>
          </button>
        ))}
      </div>
      {unidade === 'custom' ? (
        <div className="grid grid-cols-2 gap-3 rounded border border-border bg-bg-elevated p-3">
          <Campo
            rotulo="Nome da unidade"
            obrigatorio
            dica="Aparece antes do número, como em ref 12."
            erro={
              mostrarErros && customLabel.trim().length === 0
                ? 'Informe o nome da unidade.'
                : undefined
            }
          >
            <Input
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              placeholder="Ex.: ref, ponto, vão"
              maxLength={20}
              autoComplete="off"
            />
          </Campo>
          <Campo
            rotulo="Metros por unidade"
            obrigatorio
            erro={
              mostrarErros && !(customDivisor > 0)
                ? 'Informe quantos metros vale uma unidade.'
                : undefined
            }
          >
            <Input
              type="number"
              inputMode="decimal"
              min="0.1"
              step="0.1"
              value={customDivisor}
              onChange={(e) => setCustomDivisor(Number(e.target.value))}
              placeholder="Ex.: 25"
              className="tabular text-right"
            />
          </Campo>
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
  setNumeracao,
  mostrarErros
}: {
  valorInicial: number
  setValorInicial: (n: number) => void
  cor: string
  setCor: (c: string) => void
  labelUnidade: string
  divisorM: number
  numeracao: 'crescente' | 'decrescente'
  setNumeracao: (n: 'crescente' | 'decrescente') => void
  mostrarErros: boolean
}): ReactNode {
  // Preview dos 4 primeiros marcadores. 'decrescente' baixa a partir do inicial.
  const preview = [0, 1, 2, 3].map((i) => {
    const valor = numeracao === 'decrescente' ? valorInicial - i : valorInicial + i
    const fmt = Number.isInteger(valor) ? String(valor) : valor.toFixed(2).replace('.', ',')
    return `${labelUnidade} ${fmt}`
  })

  return (
    <div className="space-y-3">
      <Campo
        rotulo={`Valor no início do eixo (${labelUnidade})`}
        obrigatorio
        className="max-w-sm"
        dica={`Se o eixo começa no ${labelUnidade} 5, digite 5. Os marcadores seguintes saem a cada ${divisorM.toLocaleString('pt-BR')} m, que é uma unidade.`}
        erro={
          mostrarErros && !(Number.isFinite(valorInicial) && valorInicial >= 0)
            ? 'O valor inicial não pode ser negativo.'
            : undefined
        }
      >
        <Input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={valorInicial}
          onChange={(e) => setValorInicial(Number(e.target.value))}
          className="tabular text-right"
        />
      </Campo>

      <div>
        <Label id="kml-numeracao-rotulo">Numeração ao longo do eixo</Label>
        <div
          className="mt-1 grid grid-cols-2 gap-2"
          role="radiogroup"
          aria-labelledby="kml-numeracao-rotulo"
        >
          {(['crescente', 'decrescente'] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={numeracao === opt}
              onClick={() => setNumeracao(opt)}
              className={cn(OPCAO, 'p-2.5', opcaoCor(numeracao === opt))}
            >
              <div className="text-sm font-medium text-text">
                {opt === 'crescente' ? 'Crescente' : 'Decrescente'}
              </div>
              <div className="tabular mt-0.5 text-sm text-text-muted">
                {opt === 'crescente'
                  ? `Aumenta a partir de ${labelUnidade} ${valorInicial}`
                  : `Diminui a partir de ${labelUnidade} ${valorInicial}`}
              </div>
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-text-muted">
          Define se a estaca aumenta ou diminui ao avançar no traçado. Não depende da orientação
          escolhida no passo 2.
        </p>
      </div>

      <div>
        <Label>Primeiros marcadores</Label>
        <div className="tabular mt-1 rounded border border-border bg-bg-panel px-3 py-2 text-sm text-text">
          {preview.join(' · ')} · …
        </div>
      </div>

      <div>
        <Label id="kml-cor-rotulo">Cor do eixo</Label>
        <div
          className="mt-1 flex flex-wrap gap-2"
          role="radiogroup"
          aria-labelledby="kml-cor-rotulo"
        >
          {TRECHO_CORES_PADRAO.map((c, i) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === cor}
              onClick={() => setCor(c)}
              className={cn(
                'h-8 w-8 rounded border-2',
                c === cor ? 'border-text' : 'border-border-strong'
              )}
              style={{ background: c }}
              aria-label={`Cor ${i + 1}`}
            />
          ))}
        </div>
        <p className="mt-1 text-xs text-text-muted">
          Diferencia este eixo dos outros no mapa e no cronograma.
        </p>
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
      <div className="flex items-center gap-2 text-sm text-text-muted">
        <Map size={14} aria-hidden />
        <span className="tabular">
          <strong className="text-text">{km(comprimentoM)} km</strong>,{' '}
          <strong className="text-text">{marcadores.length.toLocaleString('pt-BR')}</strong>{' '}
          {marcadores.length === 1 ? 'marcador' : 'marcadores'} em {labelUnidade}, numeração{' '}
          <strong className="text-text">{numeracao}</strong>, orientação{' '}
          <strong className="text-text">
            {coordsInvertidas ? 'invertida em relação ao arquivo' : 'como no arquivo'}
          </strong>
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
      <p className="text-sm text-text-muted">
        Confira o traçado e os marcadores e clique em Salvar mapa. As tarefas do eixo não mudam: o
        mapa serve só para visualizar.
      </p>
    </div>
  )
}

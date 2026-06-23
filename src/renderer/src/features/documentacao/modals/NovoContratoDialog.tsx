import { useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Sparkles, FileUp, Wand2 } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { parseBR } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useCriarContrato, useExtrairContratoDeArquivo } from '../hooks/contratos'
import { useIngerirDocumento } from '../hooks/documentos'
import type { ContratoExtraido, NaturezaContrato } from '@/types/documentacao'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
  onCriado?: (contratoId: string) => void
}

type Modo = 'documento' | 'manual'

function semExtensao(nome: string): string {
  const i = nome.lastIndexOf('.')
  return i > 0 ? nome.slice(0, i) : nome
}

/**
 * Máscara de moeda pt-BR: usa os dígitos como centavos e formata com "." de
 * milhar e "," decimal. Ex.: digitar "15217365415" → "152.173.654,15".
 */
function maskValorBR(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  const n = Number(digits) / 100
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function NovoContratoDialog({ open, onOpenChange, obraId, onCriado }: Props): ReactNode {
  const criar = useCriarContrato()
  const extrair = useExtrairContratoDeArquivo()
  const ingerir = useIngerirDocumento()

  const [modo, setModo] = useState<Modo>('documento')
  const [numero, setNumero] = useState('')
  const [contratante, setContratante] = useState('')
  const [processoSei, setProcessoSei] = useState('')
  const [natureza, setNatureza] = useState<NaturezaContrato>('publico')
  const [lei, setLei] = useState('14.133/2021')
  const [objeto, setObjeto] = useState('')
  const [modalidade, setModalidade] = useState('')
  const [vigInicio, setVigInicio] = useState('')
  const [vigFim, setVigFim] = useState('')
  const [prazoMeses, setPrazoMeses] = useState('')
  const [execInicio, setExecInicio] = useState('')
  const [execFim, setExecFim] = useState('')
  const [valor, setValor] = useState('')
  const [fiscal, setFiscal] = useState('')
  const [reajIndice, setReajIndice] = useState('')
  const [reajPeriod, setReajPeriod] = useState('')
  const [reajDataBase, setReajDataBase] = useState('')
  const [reajElegivel, setReajElegivel] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Extração por IA
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [extraido, setExtraido] = useState(false)
  const [avisos, setAvisos] = useState<string[]>([])
  const [confianca, setConfianca] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const reset = (): void => {
    setModo('documento')
    setNumero('')
    setContratante('')
    setProcessoSei('')
    setNatureza('publico')
    setLei('14.133/2021')
    setObjeto('')
    setModalidade('')
    setVigInicio('')
    setVigFim('')
    setPrazoMeses('')
    setExecInicio('')
    setExecFim('')
    setValor('')
    setFiscal('')
    setReajIndice('')
    setReajPeriod('')
    setReajDataBase('')
    setReajElegivel('')
    setError(null)
    setSourceFile(null)
    setDragOver(false)
    setExtraido(false)
    setAvisos([])
    setConfianca(null)
  }

  const aplicarExtraido = (e: ContratoExtraido): void => {
    if (e.numero) setNumero(e.numero)
    if (e.contratante) setContratante(e.contratante)
    if (e.processo_sei) setProcessoSei(e.processo_sei)
    setNatureza(e.natureza)
    if (e.lei) setLei(e.lei)
    if (e.objeto) setObjeto(e.objeto)
    if (e.modalidade_regime) setModalidade(e.modalidade_regime)
    if (e.vigencia_inicio) setVigInicio(e.vigencia_inicio)
    if (e.vigencia_fim) setVigFim(e.vigencia_fim)
    if (e.prazo_vigencia_meses != null) setPrazoMeses(String(e.prazo_vigencia_meses))
    if (e.execucao_inicio) setExecInicio(e.execucao_inicio)
    if (e.execucao_fim) setExecFim(e.execucao_fim)
    if (e.valor_original != null)
      setValor(
        e.valor_original.toLocaleString('pt-BR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
      )
    if (e.fiscal_responsavel) setFiscal(e.fiscal_responsavel)
    if (e.reajuste_indice) setReajIndice(e.reajuste_indice)
    if (e.reajuste_periodicidade_meses != null)
      setReajPeriod(String(e.reajuste_periodicidade_meses))
    if (e.reajuste_data_base) setReajDataBase(e.reajuste_data_base)
    if (e.reajuste_elegivel_em) setReajElegivel(e.reajuste_elegivel_em)
  }

  const onExtrair = async (): Promise<void> => {
    if (!sourceFile) {
      setError('Selecione ou arraste o documento do contrato primeiro.')
      return
    }
    setError(null)
    try {
      const res = await extrair.mutateAsync({ obra_id: obraId, file: sourceFile })
      aplicarExtraido(res.extraido)
      setExtraido(true)
      setAvisos(res.avisos ?? [])
      setConfianca(res.confianca ?? null)
      toast.success('Entidades extraídas — revise os campos antes de criar.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao extrair entidades do documento')
    }
  }

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) {
      setSourceFile(f)
      setExtraido(false)
    }
  }

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (!numero.trim()) {
      setError('Número do contrato é obrigatório.')
      return
    }
    const valorN = valor.trim() ? Number(parseBR(valor).toString()) : null
    try {
      const { id } = await criar.mutateAsync({
        obra_id: obraId,
        numero: numero.trim(),
        contratante: contratante.trim() || null,
        processo_sei: processoSei.trim() || null,
        natureza,
        lei: lei.trim() || null,
        objeto: objeto.trim() || null,
        modalidade_regime: modalidade.trim() || null,
        vigencia_inicio: vigInicio || null,
        vigencia_fim: vigFim || null,
        prazo_vigencia_meses: prazoMeses.trim() ? Number(prazoMeses) : null,
        execucao_inicio: execInicio || null,
        execucao_fim: execFim || null,
        valor_original: valorN,
        fiscal_responsavel: fiscal.trim() || null,
        reajuste_indice: reajIndice.trim() || null,
        reajuste_periodicidade_meses: reajPeriod.trim() ? Number(reajPeriod) : null,
        reajuste_data_base: reajDataBase || null,
        reajuste_elegivel_em: reajElegivel || null
      })
      // Se veio de um documento, ingere o próprio arquivo como "03 — Contrato".
      if (sourceFile) {
        try {
          const bytes = await sourceFile.arrayBuffer()
          await ingerir.mutateAsync({
            obra_id: obraId,
            contrato_id: id,
            tipo_codigo: '03',
            titulo: semExtensao(sourceFile.name),
            origem: 'drag_drop',
            bytes,
            nome_original: sourceFile.name,
            mime: sourceFile.type || null
          })
        } catch (errIng) {
          toast.warning(
            `Contrato criado, mas a anexação do documento falhou: ${
              errIng instanceof Error ? errIng.message : 'erro'
            }`
          )
        }
      }
      toast.success(`Contrato "${numero}" criado.`)
      reset()
      onOpenChange(false)
      onCriado?.(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar contrato')
    }
  }

  const ocupado = criar.isPending || extrair.isPending || ingerir.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      size="lg"
      disableDismiss={ocupado}
    >
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>Novo contrato</DialogTitle>
          <DialogDescription>
            O contrato é o nó central — os documentos da obra penduram nele.
          </DialogDescription>
          <div className="flex gap-1 mt-2">
            <button
              type="button"
              onClick={() => setModo('documento')}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-1 text-2xs font-mono uppercase tracking-wider rounded border',
                modo === 'documento'
                  ? 'bg-accent-glow text-accent border-accent-line'
                  : 'text-text-muted hover:text-text border-transparent'
              )}
            >
              <Sparkles size={11} /> A partir de documento (IA)
            </button>
            <button
              type="button"
              onClick={() => setModo('manual')}
              className={cn(
                'px-2 py-1 text-2xs font-mono uppercase tracking-wider rounded border',
                modo === 'manual'
                  ? 'bg-accent-glow text-accent border-accent-line'
                  : 'text-text-muted hover:text-text border-transparent'
              )}
            >
              Manual
            </button>
          </div>
        </DialogHeader>
        <DialogBody className="space-y-3 max-h-[68vh] overflow-y-auto">
          <DialogErrorBanner message={error} />

          {modo === 'documento' ? (
            <div className="space-y-2">
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className={cn(
                  'rounded border border-dashed px-4 py-5 text-center text-xs transition-colors',
                  dragOver
                    ? 'border-accent bg-accent-glow text-accent'
                    : 'border-border text-text-muted'
                )}
              >
                {sourceFile ? (
                  <span className="text-text">{sourceFile.name}</span>
                ) : (
                  <>Arraste o PDF/imagem do contrato aqui, ou</>
                )}
                <div className="mt-2 flex items-center justify-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => inputRef.current?.click()}
                    disabled={ocupado}
                  >
                    <FileUp size={12} /> Selecionar arquivo
                  </Button>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={onExtrair}
                    disabled={ocupado || !sourceFile}
                  >
                    <Wand2 size={12} /> {extrair.isPending ? 'Extraindo…' : 'Extrair com IA'}
                  </Button>
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) {
                      setSourceFile(f)
                      setExtraido(false)
                    }
                    e.target.value = ''
                  }}
                />
              </div>

              {extraido ? (
                <div className="flex items-start gap-2 rounded border border-accent-line bg-accent-glow/40 px-3 py-2 text-2xs text-text-muted">
                  <Sparkles size={12} className="mt-px shrink-0 text-accent" />
                  <div className="space-y-1">
                    <div>
                      Campos preenchidos pela IA — <strong>revise</strong> antes de criar. O arquivo
                      será anexado como “03 — Contrato”.
                      {confianca != null ? (
                        <Badge
                          variant={
                            confianca >= 0.7 ? 'success' : confianca >= 0.4 ? 'warn' : 'danger'
                          }
                          className="ml-2"
                        >
                          confiança {(confianca * 100).toFixed(0)}%
                        </Badge>
                      ) : null}
                    </div>
                    {avisos.length > 0 ? (
                      <ul className="list-disc pl-4 max-h-32 overflow-auto pr-1">
                        {avisos.map((a, i) => (
                          <li key={i}>{a}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="c-numero">Número do contrato</Label>
              <Input
                id="c-numero"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                required
                placeholder="02/2025-GOINFRA"
              />
            </div>
            <div>
              <Label htmlFor="c-contratante">Contratante</Label>
              <Input
                id="c-contratante"
                value={contratante}
                onChange={(e) => setContratante(e.target.value)}
                placeholder="GOINFRA, DNIT, SANEAGO…"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="c-sei">Processo administrativo / SEI</Label>
              <Input
                id="c-sei"
                value={processoSei}
                onChange={(e) => setProcessoSei(e.target.value)}
                placeholder="nº SEI / processo DNIT"
              />
            </div>
            <div>
              <Label htmlFor="c-natureza">Natureza</Label>
              <Select
                id="c-natureza"
                value={natureza}
                onChange={(e) => setNatureza(e.target.value as NaturezaContrato)}
              >
                <option value="publico">Público</option>
                <option value="privado">Privado</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="c-modalidade">Modalidade / regime</Label>
              <Input
                id="c-modalidade"
                value={modalidade}
                onChange={(e) => setModalidade(e.target.value)}
                placeholder="Concorrência · Contratação integrada…"
              />
            </div>
            <div>
              <Label htmlFor="c-lei">Lei / instrumento</Label>
              <Input
                id="c-lei"
                value={lei}
                onChange={(e) => setLei(e.target.value)}
                placeholder="14.133/2021 ou contrato privado"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="c-objeto">Objeto</Label>
            <Input
              id="c-objeto"
              value={objeto}
              onChange={(e) => setObjeto(e.target.value)}
              placeholder="Restauração/duplicação/pavimentação GO-XXX, km Y–Z"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="c-vig-ini">Vigência (início)</Label>
              <Input
                id="c-vig-ini"
                type="date"
                value={vigInicio}
                onChange={(e) => setVigInicio(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="c-vig-prazo">Prazo de vigência (meses)</Label>
              <Input
                id="c-vig-prazo"
                inputMode="numeric"
                value={prazoMeses}
                onChange={(e) => setPrazoMeses(e.target.value)}
                placeholder="23"
              />
            </div>
            <div>
              <Label htmlFor="c-vig-fim">Vigência (fim)</Label>
              <Input
                id="c-vig-fim"
                type="date"
                value={vigFim}
                onChange={(e) => setVigFim(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="c-exec-ini">Execução (início)</Label>
              <Input
                id="c-exec-ini"
                type="date"
                value={execInicio}
                onChange={(e) => setExecInicio(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="c-exec-fim">Execução (fim)</Label>
              <Input
                id="c-exec-fim"
                type="date"
                value={execFim}
                onChange={(e) => setExecFim(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="c-valor">Valor original (R$)</Label>
              <Input
                id="c-valor"
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(maskValorBR(e.target.value))}
                placeholder="152.173.654,15"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="c-fiscal">Fiscal / responsável técnico</Label>
            <Input
              id="c-fiscal"
              value={fiscal}
              onChange={(e) => setFiscal(e.target.value)}
              placeholder="Fiscal designado (ou órgão fiscalizador)"
            />
          </div>

          <div>
            <Label htmlFor="c-reaj-idx">Índice de reajuste</Label>
            <Input
              id="c-reaj-idx"
              value={reajIndice}
              onChange={(e) => setReajIndice(e.target.value)}
              placeholder="Índices setoriais rodoviários FGV · IGPM · IPCA…"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="c-reaj-per">Periodicidade (meses)</Label>
              <Input
                id="c-reaj-per"
                inputMode="numeric"
                value={reajPeriod}
                onChange={(e) => setReajPeriod(e.target.value)}
                placeholder="12"
              />
            </div>
            <div>
              <Label htmlFor="c-reaj-base">Data-base do reajuste</Label>
              <Input
                id="c-reaj-base"
                type="date"
                value={reajDataBase}
                onChange={(e) => setReajDataBase(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="c-reaj-eleg">Reajuste elegível em</Label>
              <Input
                id="c-reaj-eleg"
                type="date"
                value={reajElegivel}
                onChange={(e) => setReajElegivel(e.target.value)}
              />
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={ocupado}
          >
            Cancelar
          </Button>
          <Button type="submit" variant="default" disabled={ocupado || !numero.trim()}>
            {criar.isPending || ingerir.isPending ? 'Criando…' : 'Criar contrato'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

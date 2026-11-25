import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogBody,
  DialogErrorBanner,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Segmentado } from '@/components/ui/segmentado'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { formatNumber, parseNumero } from '@/lib/format'
import { numeroParaCampo } from '@/lib/mascara/numero'
import { rotuloTanqueForma, rotuloTanqueTampo } from '@/lib/rotulos'
import { useMateriaisObra } from '@/features/planejamento/hooks/parametros'
import { useExcluirAtivo, useSalvarAtivo } from '../hooks/estoque'
import {
  camposDoTanque,
  tamposDaForma,
  tanqueDosCampos,
  type CamposTanque,
  type FundoCampo,
  type TampoCampo
} from '../lib/formulario-tanque'
import {
  alturaTotal,
  capacidade,
  PADROES_TORISFERICO,
  tabelaArqueacao,
  validarTanque,
  VERSAO_TABELA,
  type FormaTanque
} from '../lib/tanque'
import type { AtivoEstoque, LeituraPor, TipoAtivo } from '../tipos'
import { ArameTanque, EscolhaPorDesenho, FundoTanque, PontaTanque } from './ArameTanque'
import { DesenhoNivel } from './DesenhoNivel'
import { MapaEscolherPonto } from './MapaEstoque'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
  /** o tipo do ativo novo; na edição vale o do ativo */
  tipo: TipoAtivo
  ativo?: AtivoEstoque | null
}

const FORMAS: FormaTanque[] = [
  'cilindrico_horizontal',
  'cilindrico_vertical',
  'eliptico_horizontal',
  'oval_horizontal',
  'retangular',
  'tabela'
]
const FUNDOS: FundoCampo[] = ['plano', 'conico', 'abaulado']
// o que cada desenho mostra, em palavras de canteiro
const APOIO_FORMA: Record<FormaTanque, string> = {
  cilindrico_horizontal: 'deitado, seção redonda',
  cilindrico_vertical: 'em pé, seção redonda',
  eliptico_horizontal: 'deitado, seção em elipse',
  oval_horizontal: 'deitado, lados retos e pontas redondas',
  retangular: 'caixa de lados retos',
  tabela: 'qualquer outro: cole a tabela'
}
const APOIO_TAMPO: Record<TampoCampo, string> = {
  plano: 'ponta reta',
  abaulado: 'calota rasa',
  semieliptico: 'curva funda',
  hemisferico: 'meia esfera',
  torisferico: 'borda arredondada'
}
const APOIO_FUNDO: Record<FundoCampo, string> = {
  plano: 'fundo reto',
  conico: 'funil',
  abaulado: 'calota rasa'
}
const AREA_TEXTO =
  'w-full rounded border border-border-strong bg-bg-panel px-2.5 py-2 text-sm text-text tabular placeholder:text-text-dim focus-visible:outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent aria-[invalid=true]:border-danger'

type CampoComErro =
  'nome' | 'material' | 'local' | 'tanque' | 'capacidade' | 'referencia' | 'unidade'

/** Cadastro e edição de um tanque ou depósito, com o ponto no mapa. No tanque, mostra a capacidade calculada. */
export function AtivoDialog({ open, onOpenChange, obraId, tipo, ativo }: Props): ReactNode {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="xl">
      {open ? (
        <Formulario
          key={ativo?.id ?? `novo-${tipo}`}
          obraId={obraId}
          tipo={ativo?.tipo ?? tipo}
          ativo={ativo ?? null}
          fechar={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  )
}

function Formulario({
  obraId,
  tipo,
  ativo,
  fechar
}: {
  obraId: string
  tipo: TipoAtivo
  ativo: AtivoEstoque | null
  fechar: () => void
}): ReactNode {
  const ehTanque = tipo === 'tanque'
  const salvar = useSalvarAtivo()
  const excluir = useExcluirAtivo()
  const confirmar = useConfirm()
  const { data: materiais = [] } = useMateriaisObra(obraId)

  const [nome, setNome] = useState(ativo?.nome ?? '')
  const [recursoId, setRecursoId] = useState(ativo?.recurso_id ?? '')
  const [unidade, setUnidade] = useState(ativo && !ehTanque ? ativo.unidade : '')
  const [capacidadeDep, setCapacidadeDep] = useState(
    ativo && !ehTanque ? numeroParaCampo(ativo.capacidade, 2) : ''
  )
  const [minimo, setMinimo] = useState(
    ativo?.estoque_minimo ? numeroParaCampo(ativo.estoque_minimo, 2) : ''
  )
  const [obs, setObs] = useState(ativo?.obs ?? '')
  const [emUso, setEmUso] = useState(ativo?.ativo ?? true)
  const [lat, setLat] = useState(ativo ? numeroParaCampo(ativo.lat, 6) : '')
  const [lng, setLng] = useState(ativo ? numeroParaCampo(ativo.lng, 6) : '')
  const [campos, setCampos] = useState<CamposTanque>(() => camposDoTanque(ativo?.dimensoes))
  const [leituraPor, setLeituraPor] = useState<LeituraPor>(ativo?.leitura_por ?? 'cheio')
  const [referencia, setReferencia] = useState(
    ativo?.altura_referencia_cm ? numeroParaCampo(ativo.altura_referencia_cm, 1) : ''
  )
  const [densidade, setDensidade] = useState(
    ativo?.densidade_kg_l ? numeroParaCampo(ativo.densidade_kg_l, 4) : ''
  )
  const [error, setError] = useState<string | null>(null)
  const [tentou, setTentou] = useState(false)
  const mudar = (p: Partial<CamposTanque>): void => setCampos((c) => ({ ...c, ...p }))

  const material = materiais.find((m) => m.id === recursoId)
  const latN = parseNumero(lat)
  const lngN = parseNumero(lng)
  const ponto = latN != null && lngN != null ? { lat: latN, lng: lngN } : null

  // o tanque das medidas digitadas: validado e, se couber, com a capacidade e a altura já calculadas
  const previa = useMemo(() => {
    if (!ehTanque) return null
    const tanque = tanqueDosCampos(campos)
    const erro = validarTanque(tanque)
    return erro
      ? { tanque, erro, litros: null, altura: null }
      : { tanque, erro: null, litros: capacidade(tanque), altura: alturaTotal(tanque) }
  }, [ehTanque, campos])

  const erros: Partial<Record<CampoComErro, string>> = {}
  if (nome.trim().length < 2) erros.nome = 'Informe o nome.'
  if (!recursoId) erros.material = 'Escolha o material guardado.'
  if (!ponto) erros.local = 'Marque no mapa onde ele fica.'
  else if (Math.abs(ponto.lat) > 90 || Math.abs(ponto.lng) > 180)
    erros.local = 'Latitude ou longitude fora do possível.'
  if (ehTanque) {
    if (previa?.erro) erros.tanque = previa.erro
    const ref = parseNumero(referencia)
    if (leituraPor === 'vazio') {
      if (!(ref != null && ref > 0)) erros.referencia = 'Informe a altura da boca até o fundo.'
      else if (previa?.altura != null && ref < previa.altura)
        erros.referencia = `A boca de medição não pode ficar abaixo do topo do tanque (${formatNumber(previa.altura, 1)} cm).`
    }
  } else {
    const cap = parseNumero(capacidadeDep)
    if (!(cap != null && cap > 0)) erros.capacidade = 'Informe a capacidade do depósito.'
    if (!(unidade.trim() || material?.unidade)) erros.unidade = 'Informe a unidade de controle.'
  }
  const erro = (c: CampoComErro): string | undefined => (tentou ? erros[c] : undefined)

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (Object.keys(erros).length > 0) {
      setTentou(true)
      const form = e.currentTarget
      requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    try {
      const tabela = ehTanque && previa ? tabelaArqueacao(previa.tanque) : null
      await salvar.mutateAsync({
        id: ativo?.id,
        dados: {
          obra_id: obraId,
          tipo,
          nome: nome.trim(),
          recurso_id: recursoId,
          unidade: ehTanque ? 'L' : unidade.trim() || material?.unidade || '',
          capacidade: tabela ? tabela[tabela.length - 1] : (parseNumero(capacidadeDep) ?? 0),
          estoque_minimo: parseNumero(minimo) ?? 0,
          lat: ponto!.lat,
          lng: ponto!.lng,
          ativo: emUso,
          obs: obs.trim() || null,
          forma: ehTanque ? campos.forma : null,
          dimensoes: ehTanque && previa ? previa.tanque : null,
          leitura_por: ehTanque ? leituraPor : 'cheio',
          altura_referencia_cm:
            ehTanque && leituraPor === 'vazio' ? (parseNumero(referencia) ?? null) : null,
          densidade_kg_l: ehTanque ? (parseNumero(densidade) ?? null) : null,
          tabela,
          tabela_versao: tabela ? VERSAO_TABELA : null
        }
      })
      toast.success(
        `${ehTanque ? 'Tanque' : 'Depósito'} "${nome.trim()}" ${ativo ? 'salvo' : 'cadastrado'}.`
      )
      fechar()
    } catch (err) {
      setError(`Não foi possível salvar. ${err instanceof Error ? err.message : 'Tente de novo.'}`)
    }
  }

  const aoExcluir = async (): Promise<void> => {
    if (!ativo) return
    const ok = await confirmar({
      title: `Excluir ${ehTanque ? 'o tanque' : 'o depósito'} "${ativo.nome}"?`,
      description: 'Os movimentos e as leituras dele também são excluídos. Não dá para desfazer.',
      confirmLabel: 'Excluir',
      variant: 'danger'
    })
    if (!ok) return
    try {
      await excluir.mutateAsync(ativo.id)
      toast.success(`"${ativo.nome}" excluído.`)
      fechar()
    } catch (err) {
      setError(`Não foi possível excluir. ${err instanceof Error ? err.message : 'Tente de novo.'}`)
    }
  }

  const ocupado = salvar.isPending || excluir.isPending
  const tampos = tamposDaForma(campos.forma)
  const medida = (rotulo: string, chave: keyof CamposTanque, dica?: string): ReactNode => (
    <Campo rotulo={rotulo} dica={dica}>
      <Input
        mascara="decimal"
        casas={1}
        value={campos[chave] as string}
        onChange={(e) => mudar({ [chave]: e.target.value } as Partial<CamposTanque>)}
        aria-invalid={erro('tanque') ? true : undefined}
      />
    </Campo>
  )

  return (
    <form onSubmit={onSubmit} noValidate>
      <DialogHeader>
        <DialogTitle>
          {ativo
            ? `Editar ${ehTanque ? 'tanque' : 'depósito'}`
            : ehTanque
              ? 'Novo tanque'
              : 'Novo depósito'}
        </DialogTitle>
      </DialogHeader>
      {/* o diálogo é alto: o corpo rola dentro da tela e o rodapé com os botões fica sempre à vista */}
      <DialogBody className="grid max-h-[calc(100dvh-9.5rem)] gap-5 overflow-y-auto lg:grid-cols-2">
        <div className="space-y-3">
          <DialogErrorBanner message={error} />
          <Campo rotulo="Nome" obrigatorio erro={erro('nome')}>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              autoComplete="off"
              data-foco-inicial
              placeholder={ehTanque ? 'Ex.: Tanque 1 de CAP' : 'Ex.: Pilha de brita 1'}
            />
          </Campo>
          <Campo
            rotulo="Material guardado"
            obrigatorio
            erro={erro('material')}
            dica={
              materiais.length === 0
                ? 'A obra ainda não tem materiais cadastrados em Orçamento › Recursos.'
                : undefined
            }
          >
            <Select value={recursoId} onChange={(e) => setRecursoId(e.target.value)}>
              <option value="">Selecionar…</option>
              {materiais.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome} ({m.unidade})
                </option>
              ))}
            </Select>
          </Campo>

          {ehTanque ? (
            <>
              <EscolhaPorDesenho<FormaTanque>
                rotulo="Formato do tanque"
                valor={campos.forma}
                aoMudar={(forma) => {
                  const aceitos = tamposDaForma(forma)
                  mudar({
                    forma,
                    tampo: aceitos.includes(campos.tampo) ? campos.tampo : (aceitos[0] ?? 'plano')
                  })
                }}
                className="grid-cols-3"
                opcoes={FORMAS.map((f) => ({
                  valor: f,
                  titulo: rotuloTanqueForma(f),
                  apoio: APOIO_FORMA[f],
                  desenho: (
                    <ArameTanque
                      forma={f}
                      tampo={f === 'cilindrico_horizontal' ? 'abaulado' : 'plano'}
                    />
                  )
                }))}
              />

              {campos.forma === 'tabela' ? (
                <Campo
                  rotulo="Tabela do fabricante"
                  obrigatorio
                  erro={erro('tanque')}
                  dica="Cole da planilha: uma linha por medida, com a altura (cm) e o volume (L)."
                >
                  <textarea
                    value={campos.tabela}
                    onChange={(e) => mudar({ tabela: e.target.value })}
                    rows={7}
                    className={AREA_TEXTO}
                    placeholder={'0\t0\n10\t850\n20\t2.300'}
                  />
                </Campo>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {campos.forma === 'cilindrico_horizontal' ||
                    campos.forma === 'cilindrico_vertical'
                      ? medida('Diâmetro interno (cm)', 'diametro')
                      : null}
                    {campos.forma === 'eliptico_horizontal' ||
                    campos.forma === 'oval_horizontal' ||
                    campos.forma === 'retangular'
                      ? medida('Largura interna (cm)', 'largura')
                      : null}
                    {campos.forma !== 'cilindrico_horizontal'
                      ? medida(
                          campos.forma === 'cilindrico_vertical'
                            ? 'Altura do costado (cm)'
                            : 'Altura interna (cm)',
                          'altura'
                        )
                      : null}
                    {campos.forma !== 'cilindrico_vertical'
                      ? medida(
                          campos.forma === 'retangular'
                            ? 'Comprimento (cm)'
                            : 'Comprimento do costado (cm)',
                          'comprimento'
                        )
                      : null}
                  </div>
                  {tampos.length > 0 ? (
                    <EscolhaPorDesenho<TampoCampo>
                      rotulo="Tampos (as pontas do tanque)"
                      valor={campos.tampo}
                      aoMudar={(tampo) => mudar({ tampo })}
                      className={tampos.length > 3 ? 'grid-cols-3 sm:grid-cols-5' : 'grid-cols-3'}
                      opcoes={tampos.map((t) => ({
                        valor: t,
                        titulo: rotuloTanqueTampo(t),
                        apoio: APOIO_TAMPO[t],
                        desenho: <PontaTanque tampo={t} />
                      }))}
                    />
                  ) : null}
                  {tampos.length > 0 &&
                  (campos.tampo === 'abaulado' || campos.tampo === 'torisferico') ? (
                    <div className="grid grid-cols-2 gap-3">
                      {campos.tampo === 'abaulado'
                        ? medida(
                            'Flecha do tampo (cm)',
                            'flecha',
                            'Meça o quanto o tampo avança no centro.'
                          )
                        : null}
                      {campos.tampo === 'torisferico' ? (
                        <Campo rotulo="Padrão do tampo">
                          <Select
                            value={campos.torisferico}
                            onChange={(e) => mudar({ torisferico: e.target.value })}
                          >
                            {PADROES_TORISFERICO.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.nome}
                              </option>
                            ))}
                          </Select>
                        </Campo>
                      ) : null}
                    </div>
                  ) : null}
                  {campos.forma === 'cilindrico_vertical' ? (
                    <EscolhaPorDesenho<FundoCampo>
                      rotulo="Fundo do tanque"
                      valor={campos.fundo}
                      aoMudar={(fundo) => mudar({ fundo })}
                      className="grid-cols-3"
                      opcoes={FUNDOS.map((f) => ({
                        valor: f,
                        titulo: rotuloTanqueTampo(f),
                        apoio: APOIO_FUNDO[f],
                        desenho: <FundoTanque fundo={f} />
                      }))}
                    />
                  ) : null}
                  {campos.forma === 'cilindrico_vertical' && campos.fundo !== 'plano' ? (
                    <div className="grid grid-cols-2 gap-3">
                      {campos.fundo === 'conico'
                        ? medida('Altura do cone (cm)', 'alturaFundo')
                        : null}
                      {campos.fundo === 'abaulado'
                        ? medida('Flecha do fundo (cm)', 'flecha')
                        : null}
                    </div>
                  ) : null}
                  {erro('tanque') ? (
                    <p role="alert" className="text-xs font-medium text-danger">
                      {erro('tanque')}
                    </p>
                  ) : null}
                </div>
              )}

              <div className="flex items-center gap-4 rounded border border-border bg-bg-elevated p-3">
                <DesenhoNivel
                  tanque={previa && !previa.erro ? previa.tanque : null}
                  fracao={previa && !previa.erro ? 0.6 : null}
                  status={previa && !previa.erro ? 'normal' : 'sem_saldo'}
                  rotulo="Desenho da seção do tanque, com o nível de exemplo em 60%"
                  className="h-20 w-20"
                />
                <div className="min-w-0 text-sm">
                  <p className="text-text-muted">Capacidade calculada</p>
                  <p
                    className="text-xl font-semibold tabular text-text"
                    data-testid="estoque-capacidade"
                  >
                    {previa?.litros != null ? `${formatNumber(previa.litros, 0)} L` : '—'}
                  </p>
                  <p className="text-xs text-text-muted">
                    {previa?.altura != null
                      ? `Altura da régua: ${formatNumber(previa.altura, 1)} cm. Confira com a placa do tanque; use as medidas internas.`
                      : 'Preencha as medidas para ver a capacidade.'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-text">A régua mede</span>
                  <Segmentado<LeituraPor>
                    rotulo="A régua mede"
                    valor={leituraPor}
                    aoMudar={setLeituraPor}
                    opcoes={[
                      { valor: 'cheio', rotulo: 'O líquido', titulo: 'Do fundo até a superfície' },
                      {
                        valor: 'vazio',
                        rotulo: 'O vazio',
                        titulo: 'Da boca de medição até a superfície'
                      }
                    ]}
                  />
                </div>
                {leituraPor === 'vazio' ? (
                  <Campo
                    rotulo="Boca até o fundo (cm)"
                    obrigatorio
                    erro={erro('referencia')}
                    dica="Altura da boca de medição até o fundo do tanque."
                  >
                    <Input
                      mascara="decimal"
                      casas={1}
                      value={referencia}
                      onChange={(e) => setReferencia(e.target.value)}
                    />
                  </Campo>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Estoque mínimo (L)" dica="Abaixo disso o tanque aparece como baixo.">
                  <Input
                    mascara="decimal"
                    casas={2}
                    value={minimo}
                    onChange={(e) => setMinimo(e.target.value)}
                  />
                </Campo>
                <Campo
                  rotulo="Densidade (kg/L)"
                  dica="Opcional. Converte a nota em toneladas e mostra o saldo em toneladas."
                >
                  <Input
                    mascara="decimal"
                    casas={4}
                    value={densidade}
                    onChange={(e) => setDensidade(e.target.value)}
                    placeholder="1,02"
                  />
                </Campo>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <Campo rotulo="Unidade" obrigatorio erro={erro('unidade')}>
                <Input
                  value={unidade}
                  onChange={(e) => setUnidade(e.target.value)}
                  placeholder={material?.unidade ?? 't'}
                  autoComplete="off"
                />
              </Campo>
              <Campo rotulo="Capacidade" obrigatorio erro={erro('capacidade')}>
                <Input
                  mascara="decimal"
                  casas={2}
                  value={capacidadeDep}
                  onChange={(e) => setCapacidadeDep(e.target.value)}
                />
              </Campo>
              <Campo rotulo="Estoque mínimo">
                <Input
                  mascara="decimal"
                  casas={2}
                  value={minimo}
                  onChange={(e) => setMinimo(e.target.value)}
                />
              </Campo>
            </div>
          )}

          <Campo rotulo="Observação">
            <textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              rows={2}
              className={AREA_TEXTO}
            />
          </Campo>
          {ativo ? (
            <label className="flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={emUso}
                onChange={(e) => setEmUso(e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              Em uso (desmarque para tirar da lista sem apagar o histórico)
            </label>
          ) : null}
          {ativo && ehTanque ? (
            <p className="text-xs text-text-muted">
              Mudar as medidas ou a régua recalcula as leituras já lançadas deste tanque.
            </p>
          ) : null}
        </div>

        <div className="space-y-3 lg:sticky lg:top-0 lg:self-start">
          <div>
            <p className="text-sm font-medium text-text">
              Local no mapa{' '}
              <span className="text-danger" aria-hidden>
                *
              </span>
            </p>
            <p className="mb-2 text-xs text-text-muted">
              Clique no ponto onde ele fica. O alfinete pode ser arrastado.
            </p>
            <MapaEscolherPonto
              obraId={obraId}
              valor={ponto}
              aoMudar={(p) => {
                setLat(numeroParaCampo(p.lat, 6))
                setLng(numeroParaCampo(p.lng, 6))
              }}
              altura={340}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Latitude" erro={erro('local')}>
              <Input
                mascara="decimal"
                casas={6}
                negativo
                value={lat}
                onChange={(e) => setLat(e.target.value)}
              />
            </Campo>
            <Campo rotulo="Longitude">
              <Input
                mascara="decimal"
                casas={6}
                negativo
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                aria-invalid={erro('local') ? true : undefined}
              />
            </Campo>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        {ativo ? (
          <Button
            type="button"
            variant="danger"
            onClick={() => void aoExcluir()}
            disabled={ocupado}
            className="mr-auto"
          >
            Excluir
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={fechar} disabled={ocupado}>
          Cancelar
        </Button>
        <Button type="submit" disabled={ocupado}>
          {salvar.isPending
            ? 'Salvando…'
            : ativo
              ? 'Salvar'
              : ehTanque
                ? 'Cadastrar tanque'
                : 'Cadastrar depósito'}
        </Button>
      </DialogFooter>
    </form>
  )
}

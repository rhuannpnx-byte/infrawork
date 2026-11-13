import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ArrowRight, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { RequireRole } from '@/components/layout/RequireRole'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Carregando, ErroConsulta, Vazio } from '@/components/ui/estado'
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/input'
import { Secao } from '@/components/ui/secao'
import { Select } from '@/components/ui/select'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import type { ObraTrecho } from '@/types/gerencial'
import { useObraTrechos } from '@/features/planejamento/hooks/trechos'
import { ctxObraTrecho } from '@/features/planejamento/lib/trecho'
import { formatMarcador, parseMarcador } from '@/lib/format/posicao'
import { contar } from '@/lib/rotulos'
import { parseQtd } from '@/features/acompanhamento/lib/parse-qtd'
import {
  TIPO_LOCAL_LABEL,
  useExcluirLocalTransporte,
  useLocaisTransporte,
  useSalvarLocalTransporte,
  useSalvarRota,
  type LocalTransporte,
  type RotaTransporte,
  type TipoLocalTransporte
} from '@/features/acompanhamento/hooks/viagens'

export function AcompanhamentoTransportePage(): ReactNode {
  return (
    <RequireRole allow={['god', 'adm', 'engenheiro', 'apoio']} pageTitle="Origens e destinos">
      <RequireObra pageTitle="Origens e destinos">
        <Inner />
      </RequireObra>
    </RequireRole>
  )
}

const TIPOS = Object.keys(TIPO_LOCAL_LABEL) as TipoLocalTransporte[]
const txtKm = (v: number | null | undefined): string =>
  v == null ? '' : String(v).replace('.', ',')
const ROTULO_COLUNA = 'text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'
const MARCA = 'h-4 w-4 accent-[var(--accent)]'
const ERRO_ACESSO = 'Informe o acesso em km, com número maior ou igual a zero.'
const ERRO_DISTANCIA = 'A distância não pode ser negativa.'

/** Depois de mostrar os erros, leva o foco ao primeiro campo marcado. */
function focarPrimeiroInvalido(form: HTMLFormElement): void {
  requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
}

/** Estaca digitada na unidade do trecho → metros no trecho; vazio limpa. */
function lerEstaca(txt: string, t: ObraTrecho | undefined): { m: number | null; erro?: string } {
  if (!txt.trim()) return { m: null }
  if (!t || t.tipo !== 'eixo') return { m: null, erro: 'Escolha um eixo para a estaca do acesso.' }
  const p = parseMarcador(txt.trim(), ctxObraTrecho(t))
  return p.metros === null
    ? { m: null, erro: `A estaca "${txt.trim()}" não é válida para este trecho.` }
    : { m: p.metros }
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const ro = !(role === 'god' || role === 'adm' || role === 'engenheiro')
  const { data, isLoading, error, refetch } = useLocaisTransporte(obraId)
  const { data: trechos = [] } = useObraTrechos(obraId)
  const salvarLocal = useSalvarLocalTransporte()
  const excluirLocal = useExcluirLocalTransporte()
  const salvarRota = useSalvarRota()
  const confirm = useConfirm()
  const [novo, setNovo] = useState<{
    nome: string
    tipo: TipoLocalTransporte
    trecho: string
    estaca: string
    acesso: string
  }>({ nome: '', tipo: 'jazida', trecho: '', estaca: '', acesso: '' })
  const [errosNovo, setErrosNovo] = useState<{ nome?: string; estaca?: string; acesso?: string }>(
    {}
  )
  const [rota, setRota] = useState({ origem: '', destino: '', dmt: '' })
  const [errosRota, setErrosRota] = useState<{ origem?: string; destino?: string; dmt?: string }>(
    {}
  )
  const [incluindo, setIncluindo] = useState<null | 'local' | 'rota' | 'pistas'>(null)
  // linhas (locais e distâncias fixas) com gravação em andamento
  const [ocupados, setOcupados] = useState<ReadonlySet<string>>(new Set())
  const locais = data?.locais ?? []
  const rotas = data?.rotas ?? []
  const nome = (id: string): string => locais.find((l) => l.id === id)?.nome ?? '?'
  const trechoDe = (id: string | null): ObraTrecho | undefined => trechos.find((t) => t.id === id)
  const ocupar = (id: string, sim: boolean): void =>
    setOcupados((s) => {
      const n = new Set(s)
      if (sim) n.add(id)
      else n.delete(id)
      return n
    })
  // grava ao sair do campo; se a gravação falhar, o campo de texto volta ao valor gravado
  const salvar = (
    l: LocalTransporte,
    patch: Partial<LocalTransporte>,
    campo?: HTMLInputElement
  ): void => {
    ocupar(l.id, true)
    void salvarLocal
      .mutateAsync({ id: l.id, obra_id: obraId, nome: l.nome, ...patch })
      .catch((e: Error) => {
        toast.error(`Não foi possível salvar o local ${l.nome}. ${e.message}`)
        if (campo) campo.value = campo.defaultValue
      })
      .finally(() => ocupar(l.id, false))
  }
  const removerLocal = async (l: LocalTransporte): Promise<void> => {
    const ok = await confirm({
      title: `Excluir o local "${l.nome}"?`,
      description:
        'As distâncias fixas com este local são apagadas e as viagens já lançadas ficam sem ele. Se o local só saiu de uso, prefira desmarcar "Ativo".',
      confirmLabel: 'Excluir local',
      variant: 'danger'
    })
    if (!ok) return
    ocupar(l.id, true)
    void excluirLocal
      .mutateAsync(l.id)
      .catch((e: Error) => toast.error(`Não foi possível excluir o local ${l.nome}. ${e.message}`))
      .finally(() => ocupar(l.id, false))
  }
  const par = (r: RotaTransporte): string => `${nome(r.origem_id)} até ${nome(r.destino_id)}`
  const gravarRota = (r: RotaTransporte, dmt: number | null, campo?: HTMLInputElement): void => {
    ocupar(r.id, true)
    void salvarRota
      .mutateAsync({
        obra_id: obraId,
        origem_id: r.origem_id,
        destino_id: r.destino_id,
        dmt_km: dmt
      })
      .catch((e: Error) => {
        toast.error(
          `Não foi possível ${dmt === null ? 'remover' : 'salvar'} a distância fixa de ${par(r)}. ${e.message}`
        )
        if (campo) campo.value = campo.defaultValue
      })
      .finally(() => ocupar(r.id, false))
  }
  const removerRota = async (r: RotaTransporte): Promise<void> => {
    const ok = await confirm({
      title: 'Remover a distância fixa?',
      description: `As viagens de ${par(r)} voltam a usar a distância calculada pelo eixo.`,
      confirmLabel: 'Remover distância',
      variant: 'danger'
    })
    if (ok) gravarRota(r, null)
  }
  const eixoNovo = trechoDe(novo.trecho)?.tipo === 'eixo' ? trechoDe(novo.trecho) : undefined
  // cada eixo da obra vira um local de pista (a viagem informa a estaca nele)
  const eixosSemPista = trechos.filter(
    (t) => t.tipo === 'eixo' && !locais.some((l) => l.tipo === 'pista' && l.trecho_id === t.id)
  )
  const criarPistas = async (): Promise<void> => {
    setIncluindo('pistas')
    try {
      for (const t of eixosSemPista) {
        const nomePista = locais.some((l) => l.nome === t.nome) ? `Pista ${t.nome}` : t.nome
        await salvarLocal.mutateAsync({
          obra_id: obraId,
          nome: nomePista,
          tipo: 'pista',
          trecho_id: t.id
        })
      }
      toast.success(
        `${contar(eixosSemPista.length, 'local de pista criado', 'locais de pista criados')} a partir dos eixos.`
      )
    } catch (e) {
      toast.error(`Não foi possível criar os locais de pista. ${(e as Error).message}`)
    } finally {
      setIncluindo(null)
    }
  }
  const incluirLocal = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    const form = e.currentTarget
    const pista = novo.tipo === 'pista'
    const est = pista ? { m: null } : lerEstaca(novo.estaca, trechoDe(novo.trecho))
    const acesso = pista || !novo.acesso.trim() ? 0 : parseQtd(novo.acesso)
    const erros = {
      nome: novo.nome.trim() ? undefined : 'Informe o nome do local.',
      estaca: est.erro,
      acesso: acesso == null || acesso < 0 ? ERRO_ACESSO : undefined
    }
    setErrosNovo(erros)
    if (erros.nome || erros.estaca || acesso == null || acesso < 0) {
      focarPrimeiroInvalido(e.currentTarget)
      return
    }
    setIncluindo('local')
    void salvarLocal
      .mutateAsync({
        obra_id: obraId,
        nome: novo.nome.trim(),
        tipo: novo.tipo,
        trecho_id: novo.trecho || null,
        estaca_acesso_m: est.m,
        distancia_acesso_km: acesso
      })
      .then(() => {
        toast.success(`Local "${novo.nome.trim()}" incluído.`)
        setNovo((n) => ({ ...n, nome: '', estaca: '', acesso: '' }))
      })
      .catch((err: Error) => {
        if (err.message.startsWith('Já existe')) {
          setErrosNovo({ nome: err.message })
          focarPrimeiroInvalido(form)
        } else toast.error(`Não foi possível incluir o local. ${err.message}`)
      })
      .finally(() => setIncluindo(null))
  }
  const incluirRota = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    const dmt = parseQtd(rota.dmt)
    const erros = {
      origem: rota.origem ? undefined : 'Escolha a origem.',
      destino: !rota.destino
        ? 'Escolha o destino.'
        : rota.destino === rota.origem
          ? 'Escolha um destino diferente da origem.'
          : undefined,
      dmt: dmt == null ? 'Informe a distância em km.' : dmt < 0 ? ERRO_DISTANCIA : undefined
    }
    setErrosRota(erros)
    if (erros.origem || erros.destino || dmt == null || dmt < 0) {
      focarPrimeiroInvalido(e.currentTarget)
      return
    }
    setIncluindo('rota')
    void salvarRota
      .mutateAsync({
        obra_id: obraId,
        origem_id: rota.origem,
        destino_id: rota.destino,
        dmt_km: dmt
      })
      .then(() => {
        toast.success('Distância fixa incluída.')
        setRota({ origem: '', destino: '', dmt: '' })
      })
      .catch((err: Error) =>
        toast.error(`Não foi possível incluir a distância fixa. ${err.message}`)
      )
      .finally(() => setIncluindo(null))
  }
  const salvando = ocupados.size > 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Origens e destinos"
        subtitle="Locais de carga e descarga e as distâncias usadas nas viagens."
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-5 xl:overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <p className="max-w-[75ch] text-sm text-text-muted">
            A distância média de transporte (DMT) da viagem soma o acesso da origem, a distância
            pelo eixo entre as estacas e o acesso do destino. Fora da pista vale a estaca onde o
            acesso encontra o eixo.
          </p>
          <span role="status" aria-live="polite" className="text-sm text-text-muted">
            {salvando ? 'Salvando…' : ''}
          </span>
        </div>
        {error ? (
          <ErroConsulta
            erro={error}
            oQue="os locais de carga e descarga"
            aoTentar={() => void refetch()}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Secao
              titulo="Locais de carga e descarga"
              semRecuo
              className="min-h-0"
              corpoClassName="flex flex-col"
              acoes={
                !ro && eixosSemPista.length > 0 ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={incluindo !== null}
                    onClick={() => void criarPistas()}
                    title={`Cria um local de pista para: ${eixosSemPista.map((t) => t.nome).join(', ')}`}
                  >
                    {incluindo === 'pistas'
                      ? 'Criando…'
                      : `Criar pista dos eixos (${eixosSemPista.length})`}
                  </Button>
                ) : null
              }
            >
              <div
                role="region"
                aria-label="Lista de locais de carga e descarga"
                tabIndex={ro || !locais.length ? 0 : undefined}
                className="min-h-0 flex-1 overflow-auto border-t border-border"
              >
                {isLoading ? (
                  <Carregando texto="Carregando os locais…" className="px-4" />
                ) : !locais.length ? (
                  <Vazio className="px-4">
                    Nenhum local cadastrado.{' '}
                    {ro
                      ? 'Peça a quem administra a obra para cadastrar as origens e os destinos das viagens.'
                      : 'Inclua abaixo as jazidas, usinas, bota-foras e a pista: são as origens e os destinos das viagens.'}
                  </Vazio>
                ) : (
                  <table className="w-full min-w-[740px] text-sm">
                    <thead className="sticky top-0 z-10 bg-bg-elevated shadow-[inset_0_-1px_0_var(--border-strong)]">
                      <tr className={`text-left ${ROTULO_COLUNA}`}>
                        <th className="w-[34%] px-3 py-2 font-semibold">Nome</th>
                        <th className="px-2 py-2 font-semibold">Tipo</th>
                        <th className="px-2 py-2 font-semibold">Trecho</th>
                        <th
                          className="px-2 py-2 font-semibold"
                          title="Onde o acesso do local encontra o eixo, na unidade do trecho"
                        >
                          Estaca do acesso
                        </th>
                        <th
                          className="px-2 py-2 text-right font-semibold"
                          title="Do local até o eixo"
                        >
                          Acesso (km)
                        </th>
                        <th className="px-2 py-2 text-center font-semibold">Ativo</th>
                        <th className="w-10" aria-label="Ações" />
                      </tr>
                    </thead>
                    <tbody>
                      {locais.map((l) => {
                        const t = trechoDe(l.trecho_id)
                        const ocupado = ocupados.has(l.id)
                        return (
                          <tr
                            key={l.id}
                            aria-busy={ocupado || undefined}
                            className="border-b border-border"
                          >
                            <td className="px-3 py-1">
                              <Input
                                key={l.nome}
                                defaultValue={l.nome}
                                disabled={ro}
                                aria-label={`Nome do local ${l.nome}`}
                                onBlur={(e) => {
                                  const v = e.target.value.trim()
                                  if (v && v !== l.nome) salvar(l, { nome: v }, e.currentTarget)
                                  else e.currentTarget.value = l.nome
                                }}
                                className="h-7 min-w-[8.5rem]"
                              />
                            </td>
                            <td className="px-2 py-1">
                              <Select
                                value={l.tipo}
                                disabled={ro}
                                aria-label={`Tipo do local ${l.nome}`}
                                onChange={(e) =>
                                  salvar(l, { tipo: e.target.value as TipoLocalTransporte })
                                }
                                className="h-7 min-w-[7.5rem]"
                              >
                                {TIPOS.map((x) => (
                                  <option key={x} value={x}>
                                    {TIPO_LOCAL_LABEL[x]}
                                  </option>
                                ))}
                              </Select>
                            </td>
                            <td className="px-2 py-1">
                              <Select
                                value={l.trecho_id ?? ''}
                                disabled={ro}
                                aria-label={`Trecho do local ${l.nome}`}
                                onChange={(e) =>
                                  salvar(l, {
                                    trecho_id: e.target.value || null,
                                    estaca_acesso_m: null
                                  })
                                }
                                className="h-7 min-w-[7.5rem]"
                                title="Na pista: a viagem informa a estaca e a produção cai no local"
                              >
                                <option value="">Sem trecho</option>
                                {trechos.map((x) => (
                                  <option key={x.id} value={x.id}>
                                    {x.tipo === 'area' ? `Área ${x.nome}` : x.nome}
                                  </option>
                                ))}
                              </Select>
                            </td>
                            {l.tipo === 'pista' ? (
                              <td colSpan={2} className="px-2 py-1 text-text-muted">
                                Estaca informada em cada viagem
                              </td>
                            ) : (
                              <>
                                <td className="px-2 py-1">
                                  {t?.tipo === 'eixo' ? (
                                    <Input
                                      key={`${l.trecho_id}:${l.estaca_acesso_m}`}
                                      defaultValue={formatMarcador(
                                        l.estaca_acesso_m,
                                        ctxObraTrecho(t)
                                      )}
                                      disabled={ro}
                                      aria-label={`Estaca do acesso do local ${l.nome}`}
                                      placeholder={formatMarcador(0, ctxObraTrecho(t))}
                                      onBlur={(e) => {
                                        const r = lerEstaca(e.target.value, t)
                                        if (r.erro) {
                                          toast.error(r.erro)
                                          e.currentTarget.value = e.currentTarget.defaultValue
                                          return
                                        }
                                        if (r.m !== l.estaca_acesso_m)
                                          salvar(l, { estaca_acesso_m: r.m }, e.currentTarget)
                                      }}
                                      className="h-7 w-28 tabular"
                                    />
                                  ) : (
                                    <span
                                      className="whitespace-nowrap text-text-muted"
                                      title={
                                        t
                                          ? 'Local em área não tem estaca: a distância vem das distâncias fixas'
                                          : 'Local sem trecho não tem estaca: a distância vem das distâncias fixas'
                                      }
                                    >
                                      Use a distância fixa
                                    </span>
                                  )}
                                </td>
                                <td className="px-2 py-1">
                                  <Input
                                    key={l.distancia_acesso_km}
                                    defaultValue={txtKm(l.distancia_acesso_km)}
                                    disabled={ro}
                                    inputMode="decimal"
                                    aria-label={`Acesso em km do local ${l.nome}`}
                                    onBlur={(e) => {
                                      const v = e.target.value.trim() ? parseQtd(e.target.value) : 0
                                      if (v == null || v < 0) {
                                        toast.error(ERRO_ACESSO)
                                        e.currentTarget.value = e.currentTarget.defaultValue
                                        return
                                      }
                                      if (v !== l.distancia_acesso_km)
                                        salvar(l, { distancia_acesso_km: v }, e.currentTarget)
                                    }}
                                    className="ml-auto h-7 w-20 text-right tabular"
                                  />
                                </td>
                              </>
                            )}
                            <td className="px-2 py-1 text-center">
                              <input
                                type="checkbox"
                                checked={l.ativo}
                                disabled={ro}
                                aria-label={`Local ${l.nome} ativo`}
                                onChange={(e) => salvar(l, { ativo: e.target.checked })}
                                className={`${MARCA} align-middle`}
                              />
                            </td>
                            <td className="px-1">
                              {!ro ? (
                                <IconButton
                                  size="sm"
                                  variant="danger"
                                  disabled={ocupado}
                                  aria-label={`Excluir o local ${l.nome}`}
                                  title="Excluir o local"
                                  onClick={() => void removerLocal(l)}
                                >
                                  <Trash2 size={14} />
                                </IconButton>
                              ) : null}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              {!ro ? (
                <form
                  aria-label="Novo local"
                  noValidate
                  className="flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-border px-4 py-3"
                  onSubmit={incluirLocal}
                >
                  <Campo
                    rotulo="Nome do novo local"
                    obrigatorio
                    erro={errosNovo.nome}
                    className="min-w-[11rem] flex-1"
                  >
                    <Input
                      value={novo.nome}
                      onChange={(e) => {
                        setNovo({ ...novo, nome: e.target.value })
                        if (errosNovo.nome) setErrosNovo({ ...errosNovo, nome: undefined })
                      }}
                      placeholder="ex.: Jazida Km 8"
                    />
                  </Campo>
                  <Campo rotulo="Tipo" className="w-44 shrink-0">
                    <Select
                      value={novo.tipo}
                      onChange={(e) =>
                        setNovo({ ...novo, tipo: e.target.value as TipoLocalTransporte })
                      }
                    >
                      {TIPOS.map((t) => (
                        <option key={t} value={t}>
                          {TIPO_LOCAL_LABEL[t]}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo rotulo="Trecho" className="w-44 shrink-0">
                    <Select
                      value={novo.trecho}
                      onChange={(e) => setNovo({ ...novo, trecho: e.target.value })}
                    >
                      <option value="">Sem trecho</option>
                      {trechos.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.tipo === 'area' ? `Área ${t.nome}` : t.nome}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  {novo.tipo !== 'pista' ? (
                    <>
                      <Campo rotulo="Estaca do acesso" erro={errosNovo.estaca} className="w-36">
                        <Input
                          value={novo.estaca}
                          onChange={(e) => setNovo({ ...novo, estaca: e.target.value })}
                          disabled={!eixoNovo}
                          placeholder={eixoNovo ? formatMarcador(0, ctxObraTrecho(eixoNovo)) : ''}
                          title={
                            eixoNovo
                              ? 'Estaca onde o acesso encontra o eixo'
                              : 'Escolha um trecho de eixo para informar a estaca'
                          }
                          className="tabular"
                        />
                      </Campo>
                      <Campo rotulo="Acesso (km)" erro={errosNovo.acesso} className="w-28">
                        <Input
                          value={novo.acesso}
                          onChange={(e) => setNovo({ ...novo, acesso: e.target.value })}
                          inputMode="decimal"
                          placeholder="0"
                          className="text-right tabular"
                        />
                      </Campo>
                    </>
                  ) : null}
                  <div className="flex flex-col gap-1">
                    <span aria-hidden className="invisible text-sm font-medium">
                      .
                    </span>
                    <Button type="submit" disabled={incluindo !== null}>
                      <Plus size={13} /> {incluindo === 'local' ? 'Incluindo…' : 'Incluir local'}
                    </Button>
                  </div>
                </form>
              ) : null}
            </Secao>

            <Secao
              titulo="Distâncias fixas"
              semRecuo
              className="min-h-0"
              corpoClassName="flex flex-col"
            >
              <p className="max-w-[75ch] px-4 pb-3 text-sm text-text-muted">
                Para o par que não se liga pelo eixo, como uma usina distante ou outro trecho. A
                distância cadastrada vale para toda viagem do par, no lugar do cálculo pelas
                estacas.
              </p>
              <div
                role="region"
                aria-label="Lista de distâncias fixas"
                tabIndex={ro || !rotas.length ? 0 : undefined}
                className="min-h-0 flex-1 overflow-y-auto border-t border-border"
              >
                {isLoading ? (
                  <Carregando texto="Carregando as distâncias…" className="px-4" />
                ) : !rotas.length ? (
                  <Vazio className="px-4">
                    Nenhuma distância fixa: as viagens usam a distância calculada pelo eixo.
                  </Vazio>
                ) : (
                  <ul>
                    {rotas.map((r) => (
                      <li
                        key={r.id}
                        aria-busy={ocupados.has(r.id) || undefined}
                        className="flex items-center gap-2 border-b border-border px-4 py-1.5 text-sm"
                      >
                        <span className="min-w-0 flex-1 break-words text-text">
                          {nome(r.origem_id)}{' '}
                          <ArrowRight
                            size={12}
                            className="inline-block align-[-1px] text-text-dim"
                            role="img"
                            aria-label="até"
                          />{' '}
                          {nome(r.destino_id)}
                        </span>
                        <Input
                          key={r.dmt_km}
                          defaultValue={txtKm(r.dmt_km)}
                          disabled={ro}
                          inputMode="decimal"
                          aria-label={`Distância fixa em km de ${par(r)}`}
                          onBlur={(e) => {
                            const v = parseQtd(e.target.value)
                            if (v == null) {
                              toast.error(
                                `Informe a distância de ${par(r)} em km. Para voltar ao cálculo pelo eixo, remova a distância fixa.`
                              )
                              e.currentTarget.value = e.currentTarget.defaultValue
                              return
                            }
                            if (v < 0) {
                              toast.error(ERRO_DISTANCIA)
                              e.currentTarget.value = e.currentTarget.defaultValue
                              return
                            }
                            if (v !== r.dmt_km) gravarRota(r, v, e.currentTarget)
                          }}
                          className="h-7 w-20 shrink-0 text-right tabular"
                        />
                        <span className="text-text-muted">km</span>
                        {!ro ? (
                          <IconButton
                            size="sm"
                            variant="danger"
                            disabled={ocupados.has(r.id)}
                            aria-label={`Remover a distância fixa de ${par(r)}`}
                            title="Remover a distância fixa"
                            onClick={() => void removerRota(r)}
                          >
                            <Trash2 size={14} />
                          </IconButton>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {!ro ? (
                <form
                  aria-label="Nova distância fixa"
                  noValidate
                  className="flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-border px-4 py-3"
                  onSubmit={incluirRota}
                >
                  <Campo
                    rotulo="Origem"
                    obrigatorio
                    erro={errosRota.origem}
                    className="min-w-[9rem] flex-1"
                  >
                    <Select
                      value={rota.origem}
                      onChange={(e) => setRota({ ...rota, origem: e.target.value })}
                    >
                      <option value="">Escolha a origem</option>
                      {locais.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.nome}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo
                    rotulo="Destino"
                    obrigatorio
                    erro={errosRota.destino}
                    className="min-w-[9rem] flex-1"
                  >
                    <Select
                      value={rota.destino}
                      onChange={(e) => setRota({ ...rota, destino: e.target.value })}
                    >
                      <option value="">Escolha o destino</option>
                      {locais.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.nome}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo rotulo="Distância (km)" obrigatorio erro={errosRota.dmt} className="w-32">
                    <Input
                      value={rota.dmt}
                      onChange={(e) => setRota({ ...rota, dmt: e.target.value })}
                      inputMode="decimal"
                      className="text-right tabular"
                    />
                  </Campo>
                  <div className="flex flex-col gap-1">
                    <span aria-hidden className="invisible text-sm font-medium">
                      .
                    </span>
                    <Button type="submit" disabled={incluindo !== null}>
                      <Plus size={13} /> {incluindo === 'rota' ? 'Incluindo…' : 'Incluir distância'}
                    </Button>
                  </div>
                </form>
              ) : null}
            </Secao>
          </div>
        )}
      </div>
    </div>
  )
}

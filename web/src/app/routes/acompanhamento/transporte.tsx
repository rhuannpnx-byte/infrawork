import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ArrowRight, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { RequireRole } from '@/components/layout/RequireRole'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
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

/** Estaca digitada na unidade do trecho → metros no trecho; vazio limpa. */
function lerEstaca(txt: string, t: ObraTrecho | undefined): { m: number | null; erro?: string } {
  if (!txt.trim()) return { m: null }
  if (!t || t.tipo !== 'eixo') return { m: null, erro: 'Escolha um eixo para a estaca do acesso.' }
  const p = parseMarcador(txt.trim(), ctxObraTrecho(t))
  return p.metros === null ? { m: null, erro: `Estaca "${txt}" inválida.` } : { m: p.metros }
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const ro = !(role === 'god' || role === 'adm' || role === 'engenheiro')
  const { data } = useLocaisTransporte(obraId)
  const { data: trechos = [] } = useObraTrechos(obraId)
  const salvarLocal = useSalvarLocalTransporte()
  const excluirLocal = useExcluirLocalTransporte()
  const salvarRota = useSalvarRota()
  const [novo, setNovo] = useState<{
    nome: string
    tipo: TipoLocalTransporte
    trecho: string
    estaca: string
    acesso: string
  }>({ nome: '', tipo: 'jazida', trecho: '', estaca: '', acesso: '' })
  const [rota, setRota] = useState({ origem: '', destino: '', dmt: '' })
  const locais = data?.locais ?? []
  const rotas = data?.rotas ?? []
  const nome = (id: string): string => locais.find((l) => l.id === id)?.nome ?? '?'
  const erro = (e: Error): void => void toast.error(e.message)
  const trechoDe = (id: string | null): ObraTrecho | undefined => trechos.find((t) => t.id === id)
  const salvar = (l: LocalTransporte, patch: Partial<LocalTransporte>): void =>
    salvarLocal.mutate({ id: l.id, obra_id: obraId, nome: l.nome, ...patch }, { onError: erro })
  const eixoNovo = trechoDe(novo.trecho)?.tipo === 'eixo' ? trechoDe(novo.trecho) : undefined
  // cada eixo da obra vira um local de pista (a viagem informa a estaca nele)
  const eixosSemPista = trechos.filter(
    (t) => t.tipo === 'eixo' && !locais.some((l) => l.tipo === 'pista' && l.trecho_id === t.id)
  )
  const criarPistas = async (): Promise<void> => {
    try {
      for (const t of eixosSemPista) {
        const nomePista = locais.some((l) => l.nome === t.nome) ? `Pista — ${t.nome}` : t.nome
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
      erro(e as Error)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Origens e destinos"
        subtitle="A DMT da viagem soma o acesso da origem, a distância pelo eixo entre as estacas e o acesso do destino. Fora da pista vale a estaca onde o acesso encontra o eixo."
      />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] gap-4 overflow-hidden p-4">
        <section className="flex min-h-0 flex-col rounded border border-border bg-bg-panel">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <h3 className="text-2xs font-mono uppercase tracking-wider text-text-muted">
              Locais de carga e descarga
            </h3>
            {!ro && eixosSemPista.length > 0 ? (
              <Button
                size="sm"
                variant="secondary"
                className="ml-auto"
                disabled={salvarLocal.isPending}
                onClick={() => void criarPistas()}
                title={eixosSemPista.map((t) => t.nome).join(', ')}
              >
                Criar pista dos eixos ({eixosSemPista.length})
              </Button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-2xs font-mono uppercase text-text-dim">
                  <th className="px-3 py-1.5 font-normal">Nome</th>
                  <th className="px-2 py-1.5 font-normal">Tipo</th>
                  <th className="px-2 py-1.5 font-normal">Trecho</th>
                  <th
                    className="px-2 py-1.5 font-normal"
                    title="Onde o acesso do local encontra o eixo, na unidade do trecho"
                  >
                    Estaca do acesso
                  </th>
                  <th className="px-2 py-1.5 font-normal" title="Do local até o eixo">
                    Acesso (km)
                  </th>
                  <th className="px-2 py-1.5 font-normal">Ativo</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {locais.map((l) => {
                  const t = trechoDe(l.trecho_id)
                  return (
                    <tr key={l.id} className="border-b border-border">
                      <td className="px-3 py-1">
                        <Input
                          key={l.nome}
                          defaultValue={l.nome}
                          disabled={ro}
                          onBlur={(e) => {
                            const v = e.target.value.trim()
                            if (v && v !== l.nome)
                              salvarLocal.mutate(
                                { id: l.id, obra_id: obraId, nome: v },
                                { onError: erro }
                              )
                          }}
                          className="h-7 text-xs"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Select
                          value={l.tipo}
                          disabled={ro}
                          onChange={(e) =>
                            salvar(l, { tipo: e.target.value as TipoLocalTransporte })
                          }
                          className="h-7 text-xs"
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
                          onChange={(e) =>
                            salvar(l, { trecho_id: e.target.value || null, estaca_acesso_m: null })
                          }
                          className="h-7 text-xs"
                          title="Na pista: a viagem informa a estaca e a produção cai no local"
                        >
                          <option value="">—</option>
                          {trechos.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.tipo === 'area' ? `Área ${x.nome}` : x.nome}
                            </option>
                          ))}
                        </Select>
                      </td>
                      {l.tipo === 'pista' ? (
                        <td colSpan={2} className="px-2 py-1 text-2xs text-text-dim">
                          estaca informada em cada viagem
                        </td>
                      ) : (
                        <>
                          <td className="px-2 py-1">
                            {t?.tipo === 'eixo' ? (
                              <Input
                                key={`${l.trecho_id}:${l.estaca_acesso_m}`}
                                defaultValue={formatMarcador(l.estaca_acesso_m, ctxObraTrecho(t))}
                                disabled={ro}
                                placeholder={formatMarcador(0, ctxObraTrecho(t))}
                                onBlur={(e) => {
                                  const r = lerEstaca(e.target.value, t)
                                  if (r.erro) return void toast.error(r.erro)
                                  if (r.m !== l.estaca_acesso_m) salvar(l, { estaca_acesso_m: r.m })
                                }}
                                className="h-7 w-28 font-mono text-xs"
                              />
                            ) : (
                              <span className="text-2xs text-text-dim">
                                {t ? 'área: use distância fixa' : 'sem trecho: use distância fixa'}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1">
                            <Input
                              key={l.distancia_acesso_km}
                              defaultValue={txtKm(l.distancia_acesso_km)}
                              disabled={ro}
                              inputMode="decimal"
                              onBlur={(e) => {
                                const v = e.target.value.trim() ? parseQtd(e.target.value) : 0
                                if (v == null || v < 0) return void toast.error('Acesso inválido.')
                                if (v !== l.distancia_acesso_km)
                                  salvar(l, { distancia_acesso_km: v })
                              }}
                              className="h-7 w-20 text-right font-mono text-xs"
                            />
                          </td>
                        </>
                      )}
                      <td className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={l.ativo}
                          disabled={ro}
                          onChange={(e) => salvar(l, { ativo: e.target.checked })}
                          className="h-3.5 w-3.5 accent-[var(--accent)]"
                        />
                      </td>
                      <td className="px-1">
                        {!ro ? (
                          <button
                            type="button"
                            title="Excluir"
                            onClick={() => excluirLocal.mutate(l.id, { onError: erro })}
                            className="text-text-dim hover:text-danger"
                          >
                            <Trash2 size={13} />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
                {!locais.length ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-text-dim">
                      Nenhum local cadastrado.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {!ro ? (
            <form
              className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!novo.nome.trim()) return void toast.error('Informe o nome do local.')
                const pista = novo.tipo === 'pista'
                const est = pista ? { m: null } : lerEstaca(novo.estaca, trechoDe(novo.trecho))
                if (est.erro) return void toast.error(est.erro)
                const acesso = pista || !novo.acesso.trim() ? 0 : parseQtd(novo.acesso)
                if (acesso == null || acesso < 0) return void toast.error('Acesso inválido.')
                salvarLocal.mutate(
                  {
                    obra_id: obraId,
                    nome: novo.nome.trim(),
                    tipo: novo.tipo,
                    trecho_id: novo.trecho || null,
                    estaca_acesso_m: est.m,
                    distancia_acesso_km: acesso
                  },
                  {
                    onSuccess: () => setNovo({ ...novo, nome: '', estaca: '', acesso: '' }),
                    onError: erro
                  }
                )
              }}
            >
              <div className="min-w-[10rem] flex-1">
                <Input
                  value={novo.nome}
                  onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
                  placeholder="Novo local (ex.: Jazida Km 8)"
                  className="h-7 text-xs"
                />
              </div>
              <div className="w-40 shrink-0">
                <Select
                  value={novo.tipo}
                  onChange={(e) =>
                    setNovo({ ...novo, tipo: e.target.value as TipoLocalTransporte })
                  }
                  className="h-7 text-xs"
                  aria-label="Tipo do novo local"
                >
                  {TIPOS.map((t) => (
                    <option key={t} value={t}>
                      {TIPO_LOCAL_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-40 shrink-0">
                <Select
                  value={novo.trecho}
                  onChange={(e) => setNovo({ ...novo, trecho: e.target.value })}
                  className="h-7 text-xs"
                  aria-label="Trecho do novo local"
                >
                  <option value="">trecho: —</option>
                  {trechos.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.tipo === 'area' ? `Área ${t.nome}` : t.nome}
                    </option>
                  ))}
                </Select>
              </div>
              {novo.tipo !== 'pista' ? (
                <>
                  <Input
                    value={novo.estaca}
                    onChange={(e) => setNovo({ ...novo, estaca: e.target.value })}
                    disabled={!eixoNovo}
                    placeholder={eixoNovo ? formatMarcador(0, ctxObraTrecho(eixoNovo)) : 'estaca'}
                    aria-label="Estaca do acesso do novo local"
                    title="Estaca onde o acesso encontra o eixo"
                    className="h-7 w-28 font-mono text-xs"
                  />
                  <Input
                    value={novo.acesso}
                    onChange={(e) => setNovo({ ...novo, acesso: e.target.value })}
                    inputMode="decimal"
                    placeholder="acesso km"
                    aria-label="Distância do acesso do novo local"
                    className="h-7 w-20 font-mono text-xs"
                  />
                </>
              ) : null}
              <Button size="sm" type="submit">
                <Plus size={12} /> Incluir
              </Button>
            </form>
          ) : null}
        </section>

        <section className="flex min-h-0 flex-col rounded border border-border bg-bg-panel">
          <div className="border-b border-border px-3 py-2">
            <h3 className="text-2xs font-mono uppercase tracking-wider text-text-muted">
              Distâncias fixas (pares fora do eixo)
            </h3>
            <p className="mt-1 text-2xs text-text-dim">
              Para o par que não se liga pelo eixo (usina distante, outro trecho). A distância
              cadastrada vale para toda viagem do par, no lugar do cálculo pelas estacas.
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rotas.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs"
              >
                <span className="truncate text-text">{nome(r.origem_id)}</span>
                <ArrowRight size={12} className="shrink-0 text-text-dim" />
                <span className="truncate text-text">{nome(r.destino_id)}</span>
                <Input
                  key={r.dmt_km}
                  defaultValue={txtKm(r.dmt_km)}
                  disabled={ro}
                  inputMode="decimal"
                  onBlur={(e) => {
                    const v = parseQtd(e.target.value)
                    if (v != null && v !== r.dmt_km)
                      salvarRota.mutate(
                        {
                          obra_id: obraId,
                          origem_id: r.origem_id,
                          destino_id: r.destino_id,
                          dmt_km: v
                        },
                        { onError: erro }
                      )
                  }}
                  className="ml-auto h-7 w-20 text-right font-mono text-xs"
                />
                <span className="text-2xs text-text-dim">km</span>
                {!ro ? (
                  <button
                    type="button"
                    title="Remover distância fixa"
                    onClick={() =>
                      salvarRota.mutate(
                        {
                          obra_id: obraId,
                          origem_id: r.origem_id,
                          destino_id: r.destino_id,
                          dmt_km: null
                        },
                        { onError: erro }
                      )
                    }
                    className="text-text-dim hover:text-danger"
                  >
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </div>
            ))}
            {!rotas.length ? (
              <p className="px-3 py-4 text-xs text-text-dim">
                Nenhuma: as viagens usam a distância pelo eixo.
              </p>
            ) : null}
          </div>
          {!ro ? (
            <form
              className="flex items-center gap-2 border-t border-border px-3 py-2"
              onSubmit={(e) => {
                e.preventDefault()
                const dmt = parseQtd(rota.dmt)
                if (!rota.origem || !rota.destino || dmt == null) {
                  toast.error('Escolha a origem e o destino e informe a distância em km.')
                  return
                }
                salvarRota.mutate(
                  {
                    obra_id: obraId,
                    origem_id: rota.origem,
                    destino_id: rota.destino,
                    dmt_km: dmt
                  },
                  { onSuccess: () => setRota({ origem: '', destino: '', dmt: '' }), onError: erro }
                )
              }}
            >
              <Select
                value={rota.origem}
                onChange={(e) => setRota({ ...rota, origem: e.target.value })}
                className="h-7 flex-1 text-xs"
              >
                <option value="">origem</option>
                {locais.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nome}
                  </option>
                ))}
              </Select>
              <Select
                value={rota.destino}
                onChange={(e) => setRota({ ...rota, destino: e.target.value })}
                className="h-7 flex-1 text-xs"
              >
                <option value="">destino</option>
                {locais.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nome}
                  </option>
                ))}
              </Select>
              <Input
                value={rota.dmt}
                onChange={(e) => setRota({ ...rota, dmt: e.target.value })}
                inputMode="decimal"
                placeholder="km"
                className="h-7 w-20 font-mono text-xs"
              />
              <Button size="sm" type="submit">
                <Plus size={12} />
              </Button>
            </form>
          ) : null}
        </section>
      </div>
    </div>
  )
}

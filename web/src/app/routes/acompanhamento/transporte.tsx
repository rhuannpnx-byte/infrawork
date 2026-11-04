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
import { useObraTrechos } from '@/features/planejamento/hooks/trechos'
import { parseQtd } from '@/features/acompanhamento/lib/parse-qtd'
import {
  TIPO_LOCAL_LABEL,
  useExcluirLocalTransporte,
  useLocaisTransporte,
  useSalvarLocalTransporte,
  useSalvarRota,
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
  const [novo, setNovo] = useState<{ nome: string; tipo: TipoLocalTransporte; trecho: string }>({
    nome: '',
    tipo: 'jazida',
    trecho: ''
  })
  const [rota, setRota] = useState({ origem: '', destino: '', dmt: '' })
  const locais = data?.locais ?? []
  const rotas = data?.rotas ?? []
  const nome = (id: string): string => locais.find((l) => l.id === id)?.nome ?? '?'
  const erro = (e: Error): void => void toast.error(e.message)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Origens e destinos"
        subtitle={`${scope.obra?.nome ?? ''} — jazidas, usinas, bota-foras e a pista, usados nas viagens; o DMT de cada rota preenche a viagem.`}
      />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-4 overflow-hidden p-4">
        <section className="flex min-h-0 flex-col rounded border border-border bg-bg-panel">
          <h3 className="border-b border-border px-3 py-2 text-2xs font-mono uppercase tracking-wider text-text-muted">
            Locais de carga e descarga
          </h3>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-2xs font-mono uppercase text-text-dim">
                  <th className="px-3 py-1.5 font-normal">Nome</th>
                  <th className="px-2 py-1.5 font-normal">Tipo</th>
                  <th className="px-2 py-1.5 font-normal">Local da obra</th>
                  <th className="px-2 py-1.5 font-normal">Ativo</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {locais.map((l) => (
                  <tr key={l.id} className="border-b border-border/50">
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
                          salvarLocal.mutate(
                            {
                              id: l.id,
                              obra_id: obraId,
                              nome: l.nome,
                              tipo: e.target.value as TipoLocalTransporte
                            },
                            { onError: erro }
                          )
                        }
                        className="h-7 text-xs"
                      >
                        {TIPOS.map((t) => (
                          <option key={t} value={t}>
                            {TIPO_LOCAL_LABEL[t]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-2 py-1">
                      <Select
                        value={l.trecho_id ?? ''}
                        disabled={ro}
                        onChange={(e) =>
                          salvarLocal.mutate(
                            {
                              id: l.id,
                              obra_id: obraId,
                              nome: l.nome,
                              trecho_id: e.target.value || null
                            },
                            { onError: erro }
                          )
                        }
                        className="h-7 text-xs"
                        title="Na pista: a viagem informa a estaca de descarga e a produção cai no local"
                      >
                        <option value="">—</option>
                        {trechos.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.tipo === 'area' ? `Área ${t.nome}` : t.nome}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-2 py-1 text-center">
                      <input
                        type="checkbox"
                        checked={l.ativo}
                        disabled={ro}
                        onChange={(e) =>
                          salvarLocal.mutate(
                            { id: l.id, obra_id: obraId, nome: l.nome, ativo: e.target.checked },
                            { onError: erro }
                          )
                        }
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
                ))}
                {!locais.length ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-text-dim">
                      Nenhum local cadastrado.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {!ro ? (
            <form
              className="flex items-center gap-2 border-t border-border px-3 py-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!novo.nome.trim()) return
                salvarLocal.mutate(
                  {
                    obra_id: obraId,
                    nome: novo.nome.trim(),
                    tipo: novo.tipo,
                    trecho_id: novo.trecho || null
                  },
                  { onSuccess: () => setNovo({ ...novo, nome: '' }), onError: erro }
                )
              }}
            >
              <div className="min-w-0 flex-1">
                <Input
                  value={novo.nome}
                  onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
                  placeholder="Novo local (ex.: Jazida Km 8)"
                  className="h-7 text-xs"
                />
              </div>
              <Select
                value={novo.tipo}
                onChange={(e) => setNovo({ ...novo, tipo: e.target.value as TipoLocalTransporte })}
                className="h-7 w-36 text-xs"
              >
                {TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {TIPO_LOCAL_LABEL[t]}
                  </option>
                ))}
              </Select>
              <Select
                value={novo.trecho}
                onChange={(e) => setNovo({ ...novo, trecho: e.target.value })}
                className="h-7 w-40 text-xs"
              >
                <option value="">local da obra: —</option>
                {trechos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.tipo === 'area' ? `Área ${t.nome}` : t.nome}
                  </option>
                ))}
              </Select>
              <Button size="sm" type="submit">
                <Plus size={12} /> Incluir
              </Button>
            </form>
          ) : null}
        </section>

        <section className="flex min-h-0 flex-col rounded border border-border bg-bg-panel">
          <div className="border-b border-border px-3 py-2">
            <h3 className="text-2xs font-mono uppercase tracking-wider text-text-muted">
              Rotas e DMT
            </h3>
            <p className="mt-1 text-2xs text-text-dim">
              Distância média de transporte de cada par origem → destino; vira o DMT padrão da
              viagem (editável na viagem).
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rotas.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-2 border-b border-border/50 px-3 py-1.5 text-xs"
              >
                <span className="truncate text-text">{nome(r.origem_id)}</span>
                <ArrowRight size={12} className="shrink-0 text-text-dim" />
                <span className="truncate text-text">{nome(r.destino_id)}</span>
                <Input
                  key={r.dmt_km}
                  defaultValue={String(r.dmt_km).replace('.', ',')}
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
                    title="Remover rota"
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
              <p className="px-3 py-4 text-xs text-text-dim">Nenhuma rota.</p>
            ) : null}
          </div>
          {!ro ? (
            <form
              className="flex items-center gap-2 border-t border-border px-3 py-2"
              onSubmit={(e) => {
                e.preventDefault()
                const dmt = parseQtd(rota.dmt)
                if (!rota.origem || !rota.destino || dmt == null) return
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

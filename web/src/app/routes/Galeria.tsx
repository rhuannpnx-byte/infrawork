import { useState, type ReactNode } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Campo } from '@/components/ui/campo'
import { Segmentado } from '@/components/ui/segmentado'
import { FiltroChips } from '@/components/ui/filtro-chips'
import { BarraFiltros, Filtro, FiltroMulti, FiltroUnico } from '@/components/ui/filtros'
import { DateRangePopover } from '@/components/ui/DateRangePopover'
import { BarraAvanco, FaixaIndicadores, Indicador } from '@/components/ui/indicador'
import { Secao } from '@/components/ui/secao'
import { Carregando, ErroConsulta, Vazio } from '@/components/ui/estado'
import { Tooltip } from '@/components/ui/tooltip'
import { TabPill } from '@/components/ui/TabPill'
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from '@/components/ui/dropdown'
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Sheet, SheetBody, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { CurvaS, reaisCurto } from '@/components/charts/CurvaS'

const SERVICOS = [
  { valor: 's1', rotulo: 'S01 Desmatamento e destocamento' },
  { valor: 's2', rotulo: 'S02 Escavação, carga e transporte de 1ª categoria' },
  { valor: 's3', rotulo: 'S03 Compactação de aterro' },
  { valor: 's4', rotulo: 'S05 Sub-base' },
  { valor: 's5', rotulo: 'S06 Base' }
]

const CURVA = Array.from({ length: 30 }, (_, i) => {
  const previsto = 120e6 / (1 + Math.exp(-(i - 14) / 3.2))
  return {
    data: new Date(Date.UTC(2026, 5, 1 + i * 14)).toISOString().slice(0, 10),
    previsto,
    realizado: i <= 12 ? previsto * (0.78 + i * 0.012) : null
  }
})

const TOKENS = [
  'bg',
  'bg-menu',
  'bg-panel',
  'bg-elevated',
  'border',
  'border-strong',
  'text',
  'text-muted',
  'text-dim',
  'accent',
  'success',
  'warn',
  'danger'
]

/**
 * Galeria dos componentes compartilhados, com os seus estados. Só existe no servidor de desenvolvimento
 * (`/galeria`): serve de vitrine, de alvo do axe e de conferência dos dois temas.
 */
export function GaleriaPage(): ReactNode {
  const confirmar = useConfirm()
  const [modo, setModo] = useState<'a' | 'b' | 'c'>('a')
  const [chips, setChips] = useState<string[]>(['aberto'])
  const [multi, setMulti] = useState<string[]>([])
  const [unico, setUnico] = useState<string | null>(null)
  const [de, setDe] = useState<string | null>(null)
  const [ate, setAte] = useState<string | null>(null)
  const [aba, setAba] = useState<'um' | 'dois'>('um')
  const [dialogo, setDialogo] = useState(false)
  const [painel, setPainel] = useState(false)

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Galeria de componentes"
        subtitle="Componentes compartilhados e os seus estados, para conferir nos dois temas"
        actions={
          <>
            <Button variant="secondary" size="sm">
              Ação secundária
            </Button>
            <Button size="sm">
              <Plus size={12} /> Ação principal
            </Button>
          </>
        }
      />
      <BarraFiltros
        aoLimpar={
          multi.length || unico || de
            ? () => (setMulti([]), setUnico(null), setDe(null), setAte(null))
            : null
        }
      >
        <Filtro rotulo="Período">
          <DateRangePopover
            from={de}
            to={ate}
            onChange={(d, a) => {
              setDe(d)
              setAte(a)
            }}
            placeholder="Todo o período"
          />
        </Filtro>
        <FiltroMulti rotulo="Serviços" opcoes={SERVICOS} selecionados={multi} aoMudar={setMulti} />
        <FiltroUnico
          rotulo="Serviço"
          todos="Todos os serviços"
          opcoes={SERVICOS}
          valor={unico}
          aoMudar={setUnico}
        />
      </BarraFiltros>

      <div className="flex-1 overflow-auto p-5 flex flex-col gap-5">
        <FaixaIndicadores rotulo="Indicadores">
          <Indicador rotulo="Avanço físico" valor="38,4%">
            <BarraAvanco valor={0.384} marca={0.42} />
            <span>previsto até hoje: 42,0%</span>
          </Indicador>
          <Indicador rotulo="Valor executado" valor="R$ 48,2 mi">
            <span>de R$ 127,2 mi previstos</span>
          </Indicador>
          <Indicador rotulo="Alertas críticos" valor="3" tom="danger">
            <span>7 alertas abertos</span>
          </Indicador>
          <Indicador rotulo="Com clique" valor="24" unidade="serviços" aoClicar={() => undefined}>
            <span>abre a página do número</span>
          </Indicador>
          <Indicador rotulo="Carregando" valor="" carregando />
        </FaixaIndicadores>

        <Secao titulo="Botões e selos" nota="variantes e tamanhos">
          <div className="flex flex-wrap items-center gap-2">
            <Button>Principal</Button>
            <Button variant="secondary">Secundário</Button>
            <Button variant="outline">Contorno</Button>
            <Button variant="ghost">Discreto</Button>
            <Button variant="danger">
              <Trash2 size={12} /> Excluir
            </Button>
            <Button variant="link">Link</Button>
            <Button disabled>Desabilitado</Button>
            <Button size="sm">Pequeno</Button>
            <Button size="lg">Grande</Button>
            <IconButton aria-label="Editar" title="Editar">
              <Pencil size={14} />
            </IconButton>
            <Tooltip content="Dica em portal, ligada por aria-describedby">
              <Button variant="secondary">Com dica</Button>
            </Tooltip>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge>Padrão</Badge>
            <Badge variant="accent">Em andamento</Badge>
            <Badge variant="success">No prazo</Badge>
            <Badge variant="warn">Em risco</Badge>
            <Badge variant="danger">Atrasado</Badge>
            <Badge variant="outline">Não iniciado</Badge>
          </div>
        </Secao>

        <Secao titulo="Campos" nota="rótulo, dica e erro ligados ao controle">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Campo rotulo="Nome" obrigatorio>
              <Input placeholder="Ex.: Frente 1" />
            </Campo>
            <Campo rotulo="Quantidade" dica="Na unidade do serviço">
              <Input inputMode="decimal" placeholder="0,00" className="tabular" />
            </Campo>
            <Campo rotulo="Estaca inicial" erro="Use o formato 12+300.">
              <Input defaultValue="12/300" />
            </Campo>
            <Campo rotulo="Tipo">
              <Select defaultValue="b">
                <option value="a">Jazida</option>
                <option value="b">Bota-fora</option>
              </Select>
            </Campo>
          </div>
        </Secao>

        <Secao titulo="Escolhas e abas">
          <div className="flex flex-wrap items-center gap-4">
            <Segmentado
              rotulo="Visão"
              valor={modo}
              aoMudar={setModo}
              opcoes={[
                { valor: 'a', rotulo: '7 dias' },
                { valor: 'b', rotulo: '30 dias' },
                {
                  valor: 'c',
                  rotulo: '90 dias',
                  desabilitado: true,
                  titulo: 'Sem dados de 90 dias'
                }
              ]}
            />
            <FiltroChips
              rotulo="Situação"
              opcoes={[
                { valor: 'aberto', rotulo: 'Abertos' },
                { valor: 'silenciado', rotulo: 'Silenciados' },
                { valor: 'resolvido', rotulo: 'Resolvidos' }
              ]}
              valores={chips}
              aoMudar={setChips}
            />
            <div role="tablist" aria-label="Abas de exemplo" className="flex gap-4">
              <TabPill active={aba === 'um'} onClick={() => setAba('um')}>
                Primeira aba
              </TabPill>
              <TabPill active={aba === 'dois'} onClick={() => setAba('dois')}>
                Segunda aba
              </TabPill>
            </div>
            <Dropdown
              trigger={
                <Button variant="secondary" aria-haspopup="menu">
                  Menu de ações
                </Button>
              }
            >
              <DropdownLabel>Linha</DropdownLabel>
              <DropdownItem>
                <Pencil size={12} /> Editar
              </DropdownItem>
              <DropdownItem disabled title="Motivo de estar desabilitado">
                Mover
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem variant="danger">
                <Trash2 size={12} /> Excluir
              </DropdownItem>
            </Dropdown>
          </div>
        </Secao>

        <div className="grid gap-5 lg:grid-cols-3">
          <Secao titulo="Carregando">
            <Carregando />
          </Secao>
          <Secao titulo="Erro de consulta">
            <ErroConsulta
              erro={new Error('permission denied for table acompanhamento_producao')}
              oQue="a produção"
              aoTentar={() => undefined}
            />
          </Secao>
          <Secao titulo="Vazio de bloco">
            <Vazio acao={<Button size="sm">Lançar produção</Button>}>
              Nenhuma produção lançada neste período. Lance a produção do dia para ver o avanço.
            </Vazio>
          </Secao>
        </div>

        <Secao titulo="Curva S" nota="previsto em linha tracejada, realizado em azul">
          <CurvaS pontos={CURVA} formatar={reaisCurto} rotuloRealizado="Executado" altura={220} />
        </Secao>

        <Secao titulo="Camadas" nota="Esc fecha só a de cima; o foco volta ao botão">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setDialogo(true)}>
              Abrir diálogo
            </Button>
            <Button variant="secondary" onClick={() => setPainel(true)}>
              Abrir painel lateral
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                void confirmar({
                  title: 'Excluir 3 lançamentos?',
                  description: 'A produção desses dias sai do realizado. Não dá para desfazer.',
                  confirmLabel: 'Excluir',
                  variant: 'danger'
                })
              }
            >
              Pedir confirmação
            </Button>
          </div>
        </Secao>

        <Secao titulo="Vazio de página">
          <EmptyState
            icon="inbox"
            title="Nenhum reajuste"
            description="Crie os grupos de índices, classifique as receitas e aplique na data do reajuste."
            action={<Button>Novo reajuste</Button>}
          />
        </Secao>

        <Secao titulo="Cores" nota="papéis do tema em uso">
          <div className="flex flex-wrap gap-2">
            {TOKENS.map((t) => (
              <div key={t} className="w-28 text-xs text-text-muted">
                <div
                  className="h-10 rounded border border-border-strong"
                  style={{ background: `var(--${t})` }}
                />
                {t}
              </div>
            ))}
          </div>
        </Secao>
      </div>

      <Dialog open={dialogo} onOpenChange={setDialogo}>
        <DialogHeader>
          <DialogTitle>Novo local</DialogTitle>
          <DialogDescription>Jazida, bota-fora ou usina usados nas viagens.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3">
          <Campo rotulo="Nome" obrigatorio erro="Informe o nome do local.">
            <Input autoFocus />
          </Campo>
          <Campo rotulo="Acesso (km)" dica="Distância do local até o eixo">
            <Input inputMode="decimal" className="tabular" />
          </Campo>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setDialogo(false)}>
            Cancelar
          </Button>
          <Button onClick={() => setDialogo(false)}>Incluir local</Button>
        </DialogFooter>
      </Dialog>

      <Sheet open={painel} onOpenChange={setPainel}>
        <SheetHeader>
          <SheetTitle>Detalhe do lançamento</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <p className="text-sm text-text-muted">Conteúdo do painel lateral.</p>
        </SheetBody>
        <SheetFooter>
          <Button variant="secondary" onClick={() => setPainel(false)}>
            Fechar
          </Button>
        </SheetFooter>
      </Sheet>
    </div>
  )
}

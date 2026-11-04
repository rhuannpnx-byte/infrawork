/**
 * U-23 (D-024) — criação, alteração essencial e remoção dos objetos de dados do projeto, sem DOM. Reaproveitável pela
 * aba Insert, pelas planilhas (botão New) e pelas ferramentas MCP (`mcp/tools-create.ts`).
 *
 * Evidência (rodada REA estática de 2026-10-14, sem executar o original, D-007):
 * - `analises/2026-10-11_dynaroad/handoff/docs/criacao_objetos.md` (§n citadas abaixo) e `montagem_obra.md`;
 * - `handoff/tabelas/criacao_objetos.tsv` (campo a campo), `excecoes_ids.tsv` (código → id de string),
 *   `presenca_campos_exemplos.tsv` (campos presentes nos 27 exemplos);
 * - pseudocódigo em `handoff/funcoes/11_criacao/<Nome>@<endereço>.c` (citado como `Nome@endereço`).
 *
 * Marcações: [O] observado no código ou nos exemplos; [I] inferido; [D] desconhecido (lacuna C-xx da análise);
 * [P] decisão de projeto do ApeX. Toda função "add*"/"set*" daqui deve rodar dentro de `Project.edit` (um nível de
 * undo, RN-027): erro desfaz tudo o que a operação fez, como `Controller::Invoke` desfaz o comando que lança [I, C-05].
 *
 * Regras comuns (§1):
 * - [O] a maioria dos objetos nasce com nome vazio; só tarefas (AutoName), RoadLine ("Road line", 14569), Area
 *   ("Area", 14033), Calendar ("Calendar", 14062) e tipos ("-") ganham nome. A exigência de nome não vazio do MCP é
 *   [P] e fica no chamador (`NAME_CANNOT_BE_EMPTY` existe, mas o ponto onde o original a lança é [D], C-02).
 * - [O] `Project::Add*` copia a fonte "primária selecionada" do UIManager para o objeto novo; sem seleção (criação por
 *   programa) usamos uma cópia de `UIManager.m_pDefaultFont` [I].
 * - [I] `m_pUIInfo` nasce nulo (o UIInfo é criado sob demanda, `KernelObject::GetOrCreateUIInfo@00930da0`).
 * - Nenhum nome do produto original aparece aqui nem na interface (regra do laboratório).
 */
import { encodeString, FT, type Field, type FieldValue } from "@apex/dr5";
import { encode, encodeContainer, type Entity, type ModelValue, type Project, type Ref } from "@apex/model";
import { Calendar, CalendarError, normalizeOrder, MAX_DATE, MIN_DATE, serializeCalendarBlob, parseCalendarBlob, validateCalendarDayBasedTimeSpan, TimeSpanError, type CalendarSpec, type GeneratorSpec, type WeekSpec } from "@apex/calendar";
import {
  addUserDependency, applyAutoDependencies, autoName, crusherRefinedTypes, DEP, DEFAULT_DEPENDENCY_ARGS, intersect, resetTimings, setBeginTime, setEndTime,
  setProjectWindow, TimingEditError, type DependencyArgs,
} from "@apex/engine";
import { asRef, num, pairs, refs } from "./values.js";

// =====================================================================================================================
// Mensagens e rótulos do original
// =====================================================================================================================

/**
 * `Exception::Code` → texto (en) da string table, via `ExceptionCodeTranslator::GetInstance@0055d470`
 * (`handoff/tabelas/excecoes_ids.tsv`) [O]. Entre parênteses: código / id da string.
 */
export const MESSAGES = {
  BEGIN_TIME_GREATER_THAN_END_TIME: "Start time is later than finish time.", // 1 / 14055
  AMOUNT_LESS_THAN_OR_EQUAL_ZERO: "Quantity has to be greater than zero.", // 2 / 14029
  NEGATIVE_UNIT_PRICE: "The unit cost cannot be negative.", // 7 / 14702
  BEGIN_STATION_GREATER_THAN_END_STATION: "Start station is greater than finish station.", // 8 / 14052
  CENTER_STATION_GREATER_THAN_END_STATION: "Center station is greater than finish station.", // 9 / 14839
  CENTER_STATION_SMALLER_THAN_BEGIN_STATION: "Center station is smaller than start station.", // 10 / 14840
  BEGIN_STATION_SMALLER_THAN_LOCATION_BEGIN_STATION: "Start station is smaller than location start station.", // 11 / 14841
  END_STATION_GREATER_THAN_LOCATION_END_STATION: "Finish station is greater than location finish station.", // 12 / 14842
  NEGATIVE_AMOUNT: "The quantity is negative.", // 16 / 14028
  WORK_SITES_DONT_INTERSECT: "Tasks do not intersect.", // 18 / 14772
  WORK_SITE_IS_OUT_OF_STATION_SPAN_RANGE: "Task outside station span.", // 19 / 14761
  ROAD_CONNECTION_IS_OUT_OF_STATION_SPAN_RANGE: "Intersection is outside station span.", // 20 / 14567
  USAGE_BREAK_IS_OUT_OF_STATION_SPAN_RANGE: "Usage break is outside road line station span.", // 21 / 14712
  NEGATIVE_DISTANCE: "Distance is negative.", // 23 / 14441
  QUANTITY_HAS_TO_BE_GREATER_THAN_ZERO: "Quantity has to be greater than zero.", // 2 / 14029
  NEGATIVE_LENGTH: "Negative length", // 22 / 14474
  UNEXPECTED_ERROR: "An unexpected error has occurred, so the action cannot be completed.", // 14693 (catch #3 do Invoke)
  PRODUCTION_RATE_LESS_THAN_OR_EQUAL_ZERO: "Production rate cannot be zero or negative.", // 24 / 14518
  PRODUCTION_RATE_COEFFICIENT_LESS_THAN_OR_EQUAL_ZERO: "Production rate coefficient cannot be zero or negative.", // 25 / 14519
  MIN_DELAY_GREATER_THAN_MAX_DELAY: "The minimum delay cannot be greater than the maximum delay.", // 26 / 14406
  WANTED_SUM_TASK_PARENT_IS_CHILD: "A lower level sum task cannot be the parent sum task.", // 27 / 14724
  DEFAULT_UNIT_CANNOT_BE_REMOVED: "Default unit cannot be removed.", // 28 / 14183
  TYPE_DERIVED_DEPENDENCY_CANNOT_BE_REMOVED: "Type-derived dependency cannot be removed.", // 33 / 14687
  NAME_CANNOT_BE_EMPTY: "Name cannot be empty.", // 34 / 14439
  CANT_REMOVE_DEFAULT_CALENDAR: "The default calendar cannot be removed.", // 35 / 14182
  UNIT_MUST_BE_MASS_UNIT: "Unit must be a mass unit.", // 36 / 14701
  WANTED_AREA_PARENT_IS_CHILD: "The selected area cannot be a parent because it is a child of this area.", // 40 / 14723
  COEFFICIENT_CANNOT_BE_LESS_THAN_OR_EQUAL_ZERO: "Coefficient must be greater than zero.", // 44 / 14117
  ZERO_LENGTH_ROADLINE: "Road line cannot be zero length.", // 45 / 14574
  ZERO_LENGTH_LOCATION: "Location cannot be zero length.", // 46 / 14370
  INVALID_POLYGON: "Invalid polygon.", // 51 / 14350
  COORDINATES_OUTSIDE_STATION_SPAN: "Coordinates are outside the station span.", // 53 / 14149
  WORK_PLACES_CANNOT_INTERSECT: "Task locations cannot intersect.", // 47 / 14758
  INVALID_STATIONS: "Invalid stations.", // 14352 (AfxMessageBox da linha nova de 13016)
  CANT_REMOVE_ROOT_SUM_TASK: "The project sum task cannot be removed.", // 48 / 14074
  CANT_REMOVE_MAIN_ROAD_LINE: "The main road line cannot be removed.", // 49 / 14072
  CANT_REMOVE_MAIN_SCHEDULE: "The default view filter cannot be removed.", // 50 / 14073
  CIRCULAR_DEPENDENCY: "The dependency could not be added as it would lead to a circular dependency.", // 56 / 14240
  DISTANCE_CANNOT_BE_NEGATIVE: "Distance cannot be negative.", // 60 / 14849
  CANT_CHANGE_SUITABILITY: "The type is used and its suitability cannot be changed.", // 61 / 14861
  TASK_TYPE_IS_UNSUITABLE: "Task type is unsuitable.", // 62 / 14661
  // std::exception sem id de string (texto fixo em inglês no binário) [O]
  INVALID_SUITABILITY: "Invalid suitability", // construtores de tarefa (LandCut@009f0300 e irmãs)
  MULTIPLE_WORK_PLACES: "unable to contain multiple work places", // WorkSite::AddWorkPlace@0093ea20
  DEFAULT_WORK_GROUP: "Default work group cannot be removed", // Project::RemoveWorkGroup@009118d0
  NO_SUCH_IMAGE: "No such image", // Project::RemoveImage@00910ef0
  // [P] mensagens do ApeX (o original não tem o caso: objeto que o Remover não aceita, projeto)
  NOT_REMOVABLE: "This object cannot be removed.",
} as const;
export type MessageCode = keyof typeof MESSAGES;

export class CreateError extends Error {
  /** `hint`: contexto para quem chamou (o MCP o mostra depois da mensagem do original) */
  constructor(readonly code: MessageCode, readonly hint?: string) {
    super(MESSAGES[code]);
    this.name = "CreateError";
  }
}
const fail = (code: MessageCode, hint?: string): never => {
  throw new CreateError(code, hint);
};

/** Rótulos de undo: textos da string table usados pelos comandos de criação (§12) [O]. */
export const CREATE_OP = {
  NEW_TASK: "New task", // 14449 CreateTaskCommand
  NEW_TASK_LOCATION: "New task location", // 14755 AddWorkPlaceCommand
  ADD_SUM_TASK: "Add sum task", // 14655
  ADD_ROAD_LINE: "Add road line", // 14570
  AREA_ADDING: "Area adding", // 14034
  ADD_INTERSECTION: "Add intersection", // 14565
  ADD_USAGE_BREAK: "Add usage break", // 14711
  ADD_VIEW_FILTER: "Add view filter", // 14581
  ADD_MILESTONE: "Add milestone", // 14401
  NEW_DEPENDENCY: "New dependency", // 14193
  ADD_UNIT: "Add unit", // 14698
  ADD_SOURCE_TYPE: "Add source type", // 14627
  ADD_DESTINATION_TYPE: "Add destination type", // 14198
  NEW_TASK_TYPE: "New task type", // 14018
  ADD_SUITABLE_TYPES: "Add suitable task types", // 14651
  REMOVE_SUITABLE_TYPE: "Suitable task type removing", // 14652
  ADD_PREDECESSOR: "Add a predecessor", // 14506
  ADD_HAUL_COST: "Add haul cost", // 14514
  ADD_CALENDAR: "Add calendar", // 14063
  ADD_RESOURCE: "Add resource", // 14556
  ADD_HAUL_RESOURCE: "Add haul resource", // 14680
  ADD_CREW: "Add crew", // 14750
  REMOVE: "Remove", // 14547 RemoveCommand
  EDIT_TASK: "Edit task", // 14227 [I] (rótulo da edição da tarefa pelo diálogo)
} as const;

// =====================================================================================================================
// Campos
// =====================================================================================================================

const fld = (id: number, value: FieldValue): Field => ({ id, type: value.type, value });
const str = (id: number, v: string) => fld(id, encodeString(v));
const ref = (id: number, v: bigint | null) => fld(id, encode(FT.POINTER64, v));
const i32 = (id: number, v: number) => fld(id, encode(FT.SINT, v));
const u32 = (id: number, v: number) => fld(id, encode(FT.UINT, v));
const ulong = (id: number, v: number) => fld(id, encode(FT.ULONG, v));
const dbl = (id: number, v: number) => fld(id, encode(FT.DOUBLE, v));
const bool = (id: number, v: boolean) => fld(id, encode(FT.BOOL, v));
const i64 = (id: number, v: bigint) => fld(id, encode(FT.SINT64, v));
const refList = (id: number, oids: readonly bigint[]) => fld(id, encodeContainer(FT.POINTER64, [...oids]));
const kernel = (name = "", longName = ""): Field[] => [str(100, name), str(101, longName), ref(104, null)];

const fvRef = (oid: bigint | null): FieldValue => encode(FT.POINTER64, oid);
const fvDbl = (v: number): FieldValue => encode(FT.DOUBLE, v);
const fvInt = (v: number): FieldValue => encode(FT.SINT, v);
const fvTuple = (...items: FieldValue[]): FieldValue => ({ kind: "tuple", type: FT.TUPLE, items });
/** Mapa (0x15); vazio grava os tipos de chave e valor nulos, como os exemplos. */
function mapValue(keyType: number, valueType: number, entries: [FieldValue, FieldValue][]): FieldValue {
  return { kind: "map", type: FT.PAIR_CONTAINER, keyType: entries.length ? keyType : null, valueType: entries.length ? valueType : null, entries };
}
const emptyMap = (id: number) => fld(id, mapValue(0, 0, []));

function mapEntries(e: Entity, member: string): [FieldValue, FieldValue][] {
  const v = e.field(member)?.value;
  return v?.kind === "map" ? v.entries : [];
}
const keyOid = (k: FieldValue): bigint | null => (k.kind === "bigint" ? k.value : k.kind === "int" ? BigInt(k.value) : null);
function appendRef(e: Entity, member: string, oid: bigint): void {
  const cur = refs(e.get(member));
  if (!cur.includes(oid)) e.setRaw(member, encodeContainer(FT.POINTER64, [...cur, oid]));
}
function removeRef(e: Entity, member: string, oid: bigint): void {
  const cur = refs(e.get(member));
  if (cur.includes(oid)) e.setRaw(member, encodeContainer(FT.POINTER64, cur.filter((o) => o !== oid)));
}

// =====================================================================================================================
// Projeto: acesso
// =====================================================================================================================

function need<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error(`${what} not found`);
  return v;
}
export const projectRoot = (p: Project): Entity => need(p.root(), "Project");
const rootRef = (p: Project, member: string): Entity | undefined => p.resolve(asRef(projectRoot(p).get(member)));
const rootList = (p: Project, member: string): Entity[] => refs(projectRoot(p).get(member)).map((o) => p.get(o)).filter((e): e is Entity => !!e);
const date = (v: ModelValue | undefined): bigint => (typeof v === "bigint" ? v : 0n);
export const projectBegin = (p: Project): bigint => date(projectRoot(p).get("m_dateBegin"));
export const projectDeadline = (p: Project): bigint => date(projectRoot(p).get("m_dateDeadline"));
/** 0 PLAN, 1 SCHEDULE, 2 CONTROL (Project f226) [O] */
export const projectMode = (p: Project): number => num(projectRoot(p).get("m_nMode")) ?? 0;

/** As quatro unidades de massa do projeto (Project f219/f220/f218/f272) [O]. */
export function massUnits(p: Project): { cut: Entity; fill: Entity; crush: Entity; haul: Entity } {
  return {
    cut: need(rootRef(p, "m_pCutUnit"), "cut unit"),
    fill: need(rootRef(p, "m_pFillUnit"), "fill unit"),
    crush: need(rootRef(p, "m_pCrushUnit"), "crush unit"),
    haul: need(rootRef(p, "m_pHaulUnit"), "haul unit"),
  };
}
/** `ProjectHelpers::IsMassUnit` [I: uma das quatro unidades de massa do projeto]. */
export const isMassUnit = (p: Project, u: Entity): boolean => Object.values(massUnits(p)).some((m) => m.oid === u.oid);

const ui = (p: Project) => rootRef(p, "m_pUIManager");

/** Fonte nova: cópia da fonte padrão do UIManager [I]; sem ela, Font(FontInfo padrão) com os valores mais comuns dos exemplos [I, C-03]. */
/** U-39: `Font` nova (cópia de `from` ou da fonte padrão do projeto). */
export const createFont = (p: Project, from?: Entity): Entity => newFont(p, from);
function newFont(p: Project, from?: Entity): Entity {
  const src = from ?? p.resolve(asRef(ui(p)?.get("m_pDefaultFont")));
  if (src) return p.create(src.classId, structuredClone(src.fields));
  return p.create("Font", [...kernel(), i32(200, 8), bool(201, false), bool(202, false), bool(203, false), bool(204, false), str(205, ""), ulong(206, 0)]);
}

/** `ColorHelpers::Random@009f58c0`: três bytes aleatórios (COLORREF 0x00BBGGRR) [O]. */
export function randomColor(rng: () => number = Math.random): number {
  const b = () => Math.floor(rng() * 256) & 0xff;
  return b() | (b() << 8) | (b() << 16);
}

/** `UILayOut(owner, cor, largura)@009a9440` + `UILayOut::SetFont` [O]; fonte copiada (cada layout tem a sua, como nos exemplos). */
/** U-46: layout novo (cor, largura e cópia da fonte). */
export const createLayout = (p: Project, color: number, width: number, font?: Entity): Entity => newLayout(p, color, width, font);
function newLayout(p: Project, color: number, width: number, font?: Entity): Entity {
  return p.create("UILayOut", [...kernel(), ulong(200, color >>> 0), i32(215, width), ref(217, newFont(p, font).oid)]);
}
/** Cópia do layout de um tipo (cor, largura, fonte): tarefas herdam o visual do tipo (LandCut@009f0300) [O]. */
function copyLayout(p: Project, of: Entity | undefined): Entity {
  const lay = p.resolve(asRef(of?.get(of?.className === "SumTask" ? "m_pUILayOut" : "m_pLayOut")));
  if (!lay) return newLayout(p, randomColor(), 3);
  const font = p.resolve(asRef(lay.get("m_pFont")));
  return newLayout(p, num(lay.get("m_color")) ?? 0, num(lay.get("m_nLineWidth")) ?? 3, font);
}

// =====================================================================================================================
// Tarefas: classes, tipos e contêineres
// =====================================================================================================================

/** Botões do ribbon Insert → classe (mapa de mensagens 36060…36067, `BaseView::OnNewTask<N>`, §1.5) [O]. */
export const TASK_KINDS = {
  cut: "LandCut", // 36064, EWorkSiteType 0
  soil_replacement: "MassExchange", // 36065, 1
  crushing_plant: "CrushingPlant", // 36061, 2
  borrow_pit: "BorrowPit", // 36060, 3 (LAND_STORAGE)
  fill: "Embankment", // 36063, 4
  disposal_area: "WasteLand", // 36062, 5
  stockpile: "StockPile", // 36066, 6 (só Schedule/Control)
  task: "OtherWorkSite", // 36067, 7
} as const;
export type TaskKind = keyof typeof TASK_KINDS;
export type TaskClass = (typeof TASK_KINDS)[TaskKind];
export const TASK_CLASS_LIST: readonly TaskClass[] = ["LandCut", "Embankment", "MassExchange", "BorrowPit", "WasteLand", "StockPile", "CrushingPlant", "OtherWorkSite"];
/** Ordem do `WorkSiteContainer` (f201…f208) [O]. */
const CONTAINER_LIST: Record<TaskClass, string> = {
  LandCut: "m_vpLandCuts", Embankment: "m_vpEmbankments", MassExchange: "m_vpMassExchanges", BorrowPit: "m_vpBorrowPits",
  WasteLand: "m_vpWasteLands", StockPile: "m_vpStockPiles", CrushingPlant: "m_vpCrushingPlants", OtherWorkSite: "m_vpOtherWorkSites",
};
export const isTask = (e: Entity | undefined): boolean => !!e && (TASK_CLASS_LIST as readonly string[]).includes(e.className);

/** `SourceLandType::SuitabilityType` [O §1.4]. */
export const SOURCE_SUITABILITY = { cut: 0, soil_replacement: 1, borrow_pit: 2 } as const;
/** `DestLandType::SuitabilityType` [O §1.4]. */
export const DEST_SUITABILITY = { fill: 0, soil_replacement: 1, disposal_area: 2, stockpile: 3, crushing_plant: 4 } as const;

/** Matriz tipo × tarefa (`IsWorkSiteTypeUsableImpl` das classes, §3.3) [O]. */
const TYPE_RULES: Record<TaskClass, { source?: number; dest?: number; work?: true }> = {
  LandCut: { source: 0 }, BorrowPit: { source: 2 }, MassExchange: { source: 1, dest: 1 },
  Embankment: { dest: 0 }, WasteLand: { dest: 2 }, StockPile: { dest: 3 }, CrushingPlant: { dest: 4 }, OtherWorkSite: { work: true },
};
/** Usos de equipe (SubWorkGroupUsage 1 SEND, 2 RECEIVE, 8 OTHER) por classe: chaves de `m_cSelectedSubWorkGroups` nos exemplos [O]; MassExchange [I: "duas equipes", criacao_objetos.tsv]. */
const USAGES: Record<TaskClass, number[]> = {
  LandCut: [1], BorrowPit: [1], Embankment: [2], WasteLand: [2], CrushingPlant: [1, 2], StockPile: [1, 2], MassExchange: [1, 2], OtherWorkSite: [8],
};
/** Classes que aceitam mais de um work place: OtherWorkSite [O, `IsSupportingMultipleWorkPlaces` = mov al,1]; LandCut, Embankment e MassExchange [I, exemplos com 2–5 e U-10]; as demais um só [I]. */
const MULTI_WORK_PLACES = new Set<string>(["LandCut", "Embankment", "MassExchange", "OtherWorkSite"]);
/** Tarefas não contínuas: `SetDefaults@00913000/@009130d0` chamam SetBeginTime(início) e SetEndTime(prazo) [O]. */
const WHOLE_PROJECT = new Set<string>(["BorrowPit", "WasteLand", "StockPile", "CrushingPlant"]);
/** Quantidade principal (RN-011: flags +0x74/+0x78/+0x80) [O]. */
const SOURCE_AMOUNT = new Set<string>(["LandCut", "MassExchange", "BorrowPit"]);
const DEST_AMOUNT = new Set<string>(["Embankment", "MassExchange", "WasteLand", "StockPile", "CrushingPlant"]);

/** Tarefas do projeto na ordem do `WorkSiteContainer` do projeto (`GetWorkSitesBegin`) [O]. */
export function allTasks(p: Project): Entity[] {
  const c = rootRef(p, "m_pWSContainer");
  if (!c) return TASK_CLASS_LIST.flatMap((k) => p.byClass(k));
  return TASK_CLASS_LIST.flatMap((k) => refs(c.get(CONTAINER_LIST[k]))).map((o) => p.get(o)).filter((e): e is Entity => !!e);
}
/** `WorkSiteContainer::GetNewestWorkSite@00998350`: a de maior OID [O]. */
function newestTask(p: Project): Entity | undefined {
  let best: Entity | undefined;
  for (const t of allTasks(p)) if (!best || t.oid > best.oid) best = t;
  return best;
}
export const rootSumTask = (p: Project): Entity => need(rootRef(p, "m_pRootSumTask"), "root sum task");
export const mainRoadLine = (p: Project): Entity => need(rootRef(p, "m_pMainRoadLine"), "main road line");

/** Tipos de uma tarefa (vslot +0x3c `GetWorkSiteTypes`) [I]. */
export function typesOfTask(p: Project, t: Entity): Entity[] {
  return ["m_pSourceLandType", "m_pDestLandType", "m_pWorkType"].filter((m) => t.members().includes(m)).map((m) => p.resolve(asRef(t.get(m)))).filter((e): e is Entity => !!e);
}
export const workPlacesOf = (p: Project, t: Entity): Entity[] => refs(t.get("m_vpWorkPlaces")).map((o) => p.get(o)).filter((e): e is Entity => !!e);
const locationOf = (p: Project, wp: Entity) => p.resolve(asRef(wp.get("m_pLocation")));
/** Road line (ou área) do 1º work place (`WorkSite::RestoreSubjects@00942140`) [O]. */
export function roadLineOfTask(p: Project, t: Entity): Entity | undefined {
  const wp = workPlacesOf(p, t)[0];
  return wp ? p.resolve(asRef(locationOf(p, wp)?.get("m_pRoadLine"))) : undefined;
}

/** Faixa de estacas de uma road line (vslots +0x18/+0x1c) ou de uma área (0…1, `GetDefaultLocation` e exemplos) [O/I]. */
export function stationSpan(rl: Entity): { min: number; max: number } {
  if (rl.className === "Area") return { min: 0, max: 1 };
  return { min: num(rl.get("m_nStationBegin")) ?? 0, max: num(rl.get("m_nStationEnd")) ?? 0 };
}
const isLocation = (e: Entity | undefined) => e?.className === "RoadLine" || e?.className === "Area";

// ---------- tipo padrão (§3.5) ----------

/** `Project::GetDefaultSourceLandType(suitability)@0090e8d0`: o da última tarefa com essa adequação; senão o 1º do projeto; senão cria "-" [O]. */
function defaultSourceType(p: Project, st: number): Entity {
  let last: Entity | undefined;
  for (const t of allTasks(p)) {
    const s = t.members().includes("m_pSourceLandType") ? p.resolve(asRef(t.get("m_pSourceLandType"))) : undefined;
    if (s && num(s.get("m_nSuitabilityType")) === st) last = s;
  }
  return last ?? rootList(p, "m_vpSourceLandTypes").find((s) => num(s.get("m_nSuitabilityType")) === st) ?? addSourceLandType(p, { suitability: st });
}
/** `Project::GetDefaultDestLandType(suitability)@0090e6f0` (mesma regra) [O]. */
function defaultDestType(p: Project, st: number): Entity {
  let last: Entity | undefined;
  for (const t of allTasks(p)) {
    const d = t.members().includes("m_pDestLandType") ? p.resolve(asRef(t.get("m_pDestLandType"))) : undefined;
    if (d && num(d.get("m_nSuitabilityType")) === st) last = d;
  }
  return last ?? rootList(p, "m_vpDestLandTypes").find((d) => num(d.get("m_nSuitabilityType")) === st) ?? addDestLandType(p, { suitability: st });
}
/** `Project::GetDefaultWorkType@0090e9f0`: o da última OtherWorkSite; senão o último de m_vpWorkTypes; senão cria "-" [O]. */
function defaultWorkType(p: Project): Entity {
  let last: Entity | undefined;
  for (const t of allTasks(p)) if (t.className === "OtherWorkSite") last = p.resolve(asRef(t.get("m_pWorkType"))) ?? last;
  return last ?? rootList(p, "m_vpWorkTypes").at(-1) ?? addWorkType(p, {});
}

// =====================================================================================================================
// Unidades, custos de transporte, tipos (§7, §8)
// =====================================================================================================================

/** `Project::AddUnit(nome, nome longo)@0090ce20` → `Unit@009f5070` (só o kernel), no fim de m_vpUnits [O]. */
export function addUnit(p: Project, o: { name?: string | undefined; longName?: string | undefined }): Entity {
  const u = p.create("Unit", kernel(o.name ?? "", o.longName ?? ""));
  appendRef(projectRoot(p), "m_vpUnits", u.oid);
  return u;
}

/** `Project::AddPriceVector(nome, nome longo)@0090c090` → `PriceVector(this, nomes, unidade de corte)@00951d40`; m_distances vazio [O]. */
export function addPriceVector(p: Project, o: { name?: string | undefined; longName?: string | undefined; unit?: Entity | undefined; points?: readonly (readonly [number, number])[] | undefined }): Entity {
  const pv = p.create("PriceVector", [...kernel(o.name ?? "", o.longName ?? ""), emptyMap(200), ref(202, (o.unit ?? massUnits(p).cut).oid)]);
  appendRef(projectRoot(p), "m_vpPriceVectors", pv.oid);
  for (const [d, price] of o.points ?? []) setPriceAtDistance(pv, d, price);
  return pv;
}

/** `PriceVector::SetPriceAtDistance(d, preço)@00952450`: d < 0 → NEGATIVE_DISTANCE; senão m_distances[d] = preço (mapa ordenado) [O]. */
export function setPriceAtDistance(pv: Entity, distance: number, price: number): void {
  if (!(distance >= 0)) fail("NEGATIVE_DISTANCE");
  const m = new Map<number, number>();
  for (const [k, v] of pairs(pv.get("m_distances"))) m.set(num(k) ?? 0, num(v) ?? 0);
  m.set(distance, price);
  const entries = [...m].sort((a, b) => a[0] - b[0]).map(([k, v]) => [fvDbl(k), fvDbl(v)] as [FieldValue, FieldValue]);
  pv.setRaw("m_distances", mapValue(FT.DOUBLE, FT.DOUBLE, entries));
}

/** Campos comuns de `WorkSiteType(unidade, nomes)@00993790`: dependências vazias, layout de cor aleatória e largura 3, m_strPriceUnit "" [O]. */
function workSiteTypeFields(p: Project, name: string, longName: string, unit: Entity): Field[] {
  return [...kernel(name, longName), refList(200, []), ref(201, newLayout(p, randomColor(), 3).oid), str(202, ""), ref(210, unit.oid)];
}

export interface SourceTypeSpec {
  suitability: number;
  name?: string | undefined;
  longName?: string | undefined;
  priceVector?: Entity | undefined;
  unit?: Entity | undefined;
}
/**
 * `Project::AddSourceLandType(suitability)@0090c9c0` → `@0090c7b0(nome "-", "", priceVector, unidade)` [O]:
 * - unidade = a informada, senão a de corte;
 * - custo de transporte = o informado, senão o ÚLTIMO de m_vpPriceVectors (`*(end − 4)` no pseudocódigo; o texto do
 *   §7 diz "o 1º", o código prevalece) [O]; sem nenhum, cria antes o PriceVector "-" [O];
 * - `SetConvCoeff(unidade, corte|aterro|britagem|transporte, 1.0)` nas 4 unidades de massa [O];
 * - `SetSuitabilityType(param)`; m_dMaxHaulDistance 0.0 (sem limite); listas e mapas vazios [O].
 */
export function addSourceLandType(p: Project, o: SourceTypeSpec): Entity {
  const mu = massUnits(p);
  const unit = o.unit ?? mu.cut;
  const pv = o.priceVector ?? rootList(p, "m_vpPriceVectors").at(-1) ?? addPriceVector(p, { name: "-" });
  const t = p.create("SourceLandType", [
    ...workSiteTypeFields(p, o.name ?? "-", o.longName ?? "", unit),
    refList(400, []), ref(402, pv.oid), i32(404, 0), refList(405, []), emptyMap(407), emptyMap(408), dbl(409, 0),
  ]);
  for (const to of [mu.cut, mu.fill, mu.crush, mu.haul]) setConvCoeff(p, t, unit, to, 1.0);
  t.set("m_nSuitabilityType", o.suitability);
  appendRef(projectRoot(p), "m_vpSourceLandTypes", t.oid);
  return t;
}

/** `Project::AddDestLandType(suitability)@0090b330` → `@0090b260(nome "-", "", unidade = de aterro)` + `SetSuitabilityType` [O]. */
export function addDestLandType(p: Project, o: { suitability: number; name?: string | undefined; longName?: string | undefined; unit?: Entity | undefined }): Entity {
  const t = p.create("DestLandType", [...workSiteTypeFields(p, o.name ?? "-", o.longName ?? "", o.unit ?? massUnits(p).fill), i32(404, o.suitability), refList(405, [])]);
  appendRef(projectRoot(p), "m_vpDestLandTypes", t.oid);
  return t;
}

/** `Project::AddWorkType()@0090d8e0` → `@0090d750(nome "-", "", unidade)`: unidade = a ÚLTIMA de m_vpUnits; sem nenhuma, cria "-" antes [O]. */
export function addWorkType(p: Project, o: { name?: string | undefined; longName?: string | undefined; unit?: Entity | undefined }): Entity {
  const unit = o.unit ?? rootList(p, "m_vpUnits").at(-1) ?? addUnit(p, { name: "-" });
  const t = p.create("WorkType", workSiteTypeFields(p, o.name ?? "-", o.longName ?? "", unit));
  appendRef(projectRoot(p), "m_vpWorkTypes", t.oid);
  return t;
}

/**
 * `SourceLandType::SetConvCoeff(de, para, c)@00947780` [O]: c ≤ 0 → COEFFICIENT_…(44); de = para = unidade do tipo → nada;
 * de = unidade do tipo → m_conversions[para] = c; para = unidade do tipo → recursão com 1/c; senão compõe pela
 * conversão já conhecida de "de" (× c) ou de "para" (÷ c); nenhuma das duas → "failed".
 */
export function setConvCoeff(p: Project, slt: Entity, from: Entity, to: Entity, c: number): void {
  if (!(c > 0) || Math.abs(c) < 1e-9) fail("COEFFICIENT_CANNOT_BE_LESS_THAN_OR_EQUAL_ZERO");
  const own = asRef(slt.get("m_pUnit"));
  const conv = new Map(mapEntries(slt, "m_conversions").map(([k, v]) => [keyOid(k), v.kind === "float" ? v.value : 0]));
  const get = (u: bigint) => (u === own ? 1 : conv.get(u));
  if (from.oid === to.oid && from.oid === own) return;
  if (from.oid === own) {
    conv.set(to.oid, c);
  } else if (to.oid === own) {
    conv.set(from.oid, 1 / c);
  } else if (get(from.oid) !== undefined) {
    conv.set(to.oid, get(from.oid)! * c);
  } else if (get(to.oid) !== undefined) {
    conv.set(from.oid, get(to.oid)! / c);
  } else {
    throw new Error("failed"); // std::exception("failed") [O]
  }
  slt.setRaw("m_conversions", mapValue(FT.POINTER64, FT.DOUBLE, [...conv].map(([u, v]) => [fvRef(u), fvDbl(v)] as [FieldValue, FieldValue])));
}

/** Tarefas que usam um tipo. */
export function tasksUsingType(p: Project, type: Entity): Entity[] {
  return allTasks(p).filter((t) => typesOfTask(p, t).some((x) => x.oid === type.oid));
}

/**
 * `SourceLandType::SetSuitabilityType@00947a80` / `DestLandType::SetSuitabilityType@009cf6a0` [O]; tipo já usado por
 * tarefa → CANT_CHANGE_SUITABILITY (61) [O código, I condição].
 */
export function setSuitabilityType(p: Project, type: Entity, st: number): void {
  if (num(type.get("m_nSuitabilityType")) === st) return;
  if (tasksUsingType(p, type).length) fail("CANT_CHANGE_SUITABILITY", `type "${type.name}" is used by tasks`);
  type.set("m_nSuitabilityType", st);
}

/**
 * Adequação origem → destino, simétrica: `SourceLandType::AddSuitableLandType(dest)@00946f10` acrescenta o destino
 * e, se o destino ainda não tem a origem, `DestLandType::AddSuitableLandType(source)@009cf2b0` [O]; remover idem [O].
 */
export function setSuitable(p: Project, source: Entity, dest: Entity, suitable: boolean): void {
  if (source.className !== "SourceLandType" || dest.className !== "DestLandType") throw new Error("suitability links a source type to a destination type");
  if (suitable) {
    appendRef(source, "m_vpSuitableTypes", dest.oid);
    appendRef(dest, "m_vpSuitableTypes", source.oid);
  } else {
    removeRef(source, "m_vpSuitableTypes", dest.oid);
    removeRef(dest, "m_vpSuitableTypes", source.oid);
  }
}

/**
 * `WorkSiteType::AddDependency(pred, succ, atraso)@00993b40` [O]: um `TypeDependency@009ae530` por par, registrado nos
 * dois tipos; se o par já existe, só `SetDelayDays`. Comando "Add a predecessor" (14506).
 */
export function addTypeDependency(p: Project, pred: Entity, succ: Entity, delayDays: number): Entity {
  for (const o of refs(pred.get("m_vpDependencies"))) {
    const d = p.get(o);
    if (d?.className === "TypeDependency" && d.get("m_pPredecessor") === pred.oid && d.get("m_pSuccessor") === succ.oid) {
      d.set("m_nDelayDays", delayDays);
      return d;
    }
  }
  const d = p.create("TypeDependency", [...kernel(), ref(200, pred.oid), ref(201, succ.oid), i32(202, delayDays)]);
  appendRef(pred, "m_vpDependencies", d.oid);
  appendRef(succ, "m_vpDependencies", d.oid);
  return d;
}

// =====================================================================================================================
// Calendários (§8)
// =====================================================================================================================

/** `DDL::Calendar(25200, 28800)@008e7960` via `WeekDayGenerator`: seg–sex 07:00 + 8 h; sáb/dom 0 h; sem geradores [O]. */
export function constructorCalendarSpec(): CalendarSpec {
  const work = { begin: 25200, length: 28800 }, off = { begin: 25200, length: 0 };
  return { version: 12, week: { flag: 1, days: [work, work, work, work, work, off, off] }, generators: [], order: [], spans: [] };
}

export const calendarManager = (p: Project): Entity => need(rootRef(p, "m_pCalendarManager"), "CalendarManager");
export const calendarsOf = (p: Project): Entity[] => refs(calendarManager(p).get("m_vpCalendars")).map((o) => p.get(o)).filter((e): e is Entity => !!e);
export const defaultCalendar = (p: Project): Entity | undefined => p.resolve(asRef(calendarManager(p).get("m_pDefaultCalendar")));
const calendarBlob = (c: Entity): Uint8Array | undefined => {
  const f = c.fields.find((x) => x.id === 100 && x.type === FT.BINARY);
  return f?.value.kind === "bytes" ? f.value.value : undefined;
};
export const calendarSpec = (c: Entity): CalendarSpec | undefined => {
  const b = calendarBlob(c);
  return b ? parseCalendarBlob(b) : undefined;
};
/** U-38: blob pronto para editar — só os geradores da lista de ordem, ordem 0…n−1 (`UnSerialize`/`Serialize`) [O]. */
export function calendarEditSpec(c: Entity): CalendarSpec {
  const s = calendarSpec(c);
  if (!s) throw new Error("calendar without definition");
  return normalizeOrder(s);
}
/** Regrava o blob (f100, tipo 0x10) — `Calendar::NotifyChanging/NotifyChanged` (memento do undo) [O]. */
export function writeCalendarSpec(c: Entity, spec: CalendarSpec): void {
  const v: FieldValue = { kind: "bytes", type: FT.BINARY, value: serializeCalendarBlob(spec) };
  const has = c.fields.some((x) => x.id === 100 && x.type === FT.BINARY);
  c.replaceFields(has ? c.fields.map((x) => (x.id === 100 && x.type === FT.BINARY ? { ...x, value: v } : x)) : [...c.fields, { id: 100, type: FT.BINARY, value: v }]);
}
/**
 * Um comando `CalendarCommands::*` [O §0.2]: muda o blob e refaz os vetores; sem expediente nenhum o
 * `MakeVectorsFromIntervals` lança "No working time" → 14693 e nada muda [I]. `fn` devolve false = sem mudança.
 */
export function editCalendar(c: Entity, fn: (s: CalendarSpec) => boolean | void): void {
  const s = calendarEditSpec(c);
  if (fn(s) === false) return;
  try {
    new Calendar(s);
  } catch (e) {
    if (e instanceof CalendarError) fail("UNEXPECTED_ERROR", e.message);
    throw e;
  }
  writeCalendarSpec(c, s);
}

export interface CalendarOptions {
  name?: string | undefined;
  longName?: string | undefined;
  /** calendário de partida; padrão do original: o 1º do gerenciador [O] */
  basedOn?: Entity | undefined;
  week?: WeekSpec["days"] | undefined;
  /** feriados fixos (StaticHoliday); acrescentados aos do calendário de partida [P] */
  holidays?: readonly { name: string; begin: bigint; end: bigint; yearly: boolean }[] | undefined;
}
/**
 * `CalendarManager::AddCalendar(nome)@00966e20` [O]: com calendários, o novo é cópia do PRIMEIRO; sem nenhum,
 * `Calendar(KernelObject)@009f52e0` = construtor de 8 h. Nome padrão da planilha: "Calendar" (14062).
 * `week`/`holidays` substituem o que o diálogo `EditCalendarDlg` editaria (comandos `CalendarCommands::*`) [I].
 */
export function addCalendar(p: Project, o: CalendarOptions): Entity {
  const mgr = calendarManager(p);
  const first = o.basedOn ?? calendarsOf(p)[0];
  const spec: CalendarSpec = (first && calendarSpec(first)) ?? constructorCalendarSpec();
  if (o.week) spec.week = { flag: spec.week.flag || 1, days: o.week };
  for (const h of o.holidays ?? []) {
    if (h.end < h.begin) fail("BEGIN_TIME_GREATER_THAN_END_TIME", `holiday "${h.name}"`);
    spec.generators.push({ type: "StaticHoliday", name: h.name, begin: h.begin, end: h.end, yearly: h.yearly ? 1 : 0 } satisfies GeneratorSpec);
  }
  spec.order = spec.generators.map((_, i) => i); // Serialize grava 0…n−1 [O, formato_calendario.md]
  const c = p.create("Calendar", [...kernel(o.name ?? "Calendar", o.longName ?? ""), fld(100, { kind: "bytes", type: FT.BINARY, value: serializeCalendarBlob(spec) })]);
  appendRef(mgr, "m_vpCalendars", c.oid);
  if (!defaultCalendar(p)) mgr.set("m_pDefaultCalendar", c.oid);
  return c;
}

/** `CalendarManager::SetDefaultCalendar@00967070` + `Project::UpdateWorkSiteDefaultCalendars@00913db0`: tarefas que usam o padrão passam ao novo [I pelo nome]. */
export function setDefaultCalendar(p: Project, cal: Entity): void {
  calendarManager(p).set("m_pDefaultCalendar", cal.oid);
  for (const t of allTasks(p)) if (t.get("m_bUseDefaultCalendar") !== false && t.get("m_pCalendar") !== cal.oid) t.set("m_pCalendar", cal.oid);
}

// =====================================================================================================================
// Recursos, transportadores, equipes (§9)
// =====================================================================================================================

/** `Project::AddResource("", "")@0090c130` → `Resource@00973fe0`: preço/hora 0.0, restrições vazias, layout aleatório largura 3 [O]. */
export function addResource(p: Project, o: { name?: string | undefined; longName?: string | undefined; hourPrice?: number | undefined }): Entity {
  if (o.hourPrice !== undefined && o.hourPrice < 0) fail("NEGATIVE_UNIT_PRICE"); // [I] o setter não foi lido
  const r = p.create("Resource", [...kernel(o.name ?? "", o.longName ?? ""), emptyMap(200), dbl(202, o.hourPrice ?? 0), ref(203, newLayout(p, randomColor(), 3).oid)]);
  appendRef(projectRoot(p), "m_vpResources", r.oid);
  return r;
}

export interface TransporterSpec {
  name?: string | undefined;
  longName?: string | undefined;
  capacity?: number | undefined;
  unit?: Entity | undefined;
  hourPrice?: number | undefined;
  /** m_mDistanceWorkAchievement: distância → produção por hora (`Transporter::AddRate@0099c3b0`) [I significado] */
  rates?: readonly (readonly [number, number])[] | undefined;
}
/**
 * `Project::AddTransporter@0090cd30` → `Transporter(project, Quantity, nomes)@0099c0a0` [O]: capacidade e unidade = as do
 * ÚLTIMO transportador; sem nenhum, 10.0 (`dDEFAULT_CAPACITY`) na unidade de transporte. Capacidade ≤ 0 → 2;
 * unidade que não é de massa → 36 [O].
 */
export function addTransporter(p: Project, o: TransporterSpec): Entity {
  const last = rootList(p, "m_vpTransporters").at(-1);
  const capacity = o.capacity ?? (last ? num(last.get("m_dCapacity")) ?? 10 : 10);
  const unit = o.unit ?? (last ? p.resolve(asRef(last.get("m_pUnit"))) : undefined) ?? massUnits(p).haul;
  if (!(capacity > 0)) fail("AMOUNT_LESS_THAN_OR_EQUAL_ZERO");
  if (!isMassUnit(p, unit)) fail("UNIT_MUST_BE_MASS_UNIT");
  if (o.hourPrice !== undefined && o.hourPrice < 0) fail("NEGATIVE_UNIT_PRICE");
  const rates = new Map<number, number>();
  for (const [d, v] of o.rates ?? []) {
    if (!(d >= 0)) fail("NEGATIVE_DISTANCE");
    if (!(v > 0)) fail("PRODUCTION_RATE_LESS_THAN_OR_EQUAL_ZERO"); // [I] validação de AddRate não lida
    rates.set(d, v);
  }
  const t = p.create("Transporter", [
    ...kernel(o.name ?? "", o.longName ?? ""), emptyMap(200), dbl(202, o.hourPrice ?? 0), ref(203, newLayout(p, randomColor(), 3).oid),
    dbl(300, capacity),
    fld(303, mapValue(FT.DOUBLE, FT.DOUBLE, [...rates].sort((a, b) => a[0] - b[0]).map(([d, v]) => [fvDbl(d), fvDbl(v)] as [FieldValue, FieldValue]))),
    ref(304, unit.oid), refList(305, []),
  ]);
  appendRef(projectRoot(p), "m_vpTransporters", t.oid);
  return t;
}

export interface WorkGroupSpec {
  name?: string | undefined;
  longName?: string | undefined;
  resources?: readonly { resource: Entity; count: number }[] | undefined;
  /** taxa de produção por tipo (m_rates: tipo → (taxa/h, custo unitário)) */
  rates?: readonly { type: Entity; rate: number; unitPrice?: number | undefined }[] | undefined;
  haulResource?: Entity | undefined;
}
/**
 * `Project::AddWorkGroup(nome, nome longo, recursos)@0090d1c0` → `WorkGroup@00991860` [O]: m_nPriceCalculation 0xFFFF,
 * m_rates vazio, m_pHaulResource nulo; sem recursos e com recursos no projeto → {primeiro recurso: 1} (`&DAT_00000001`)
 * [O]; depois `ValidateSubWorkGroupsForAllSites` (reatribui equipes das tarefas) [O chamada, I efeito].
 * Taxa ≤ 0 → PRODUCTION_RATE_… (24, `WorkGroup::SetProductionRate@00992af0`) [O]; custo unitário < 0 → 7 [I].
 */
export function addWorkGroup(p: Project, o: WorkGroupSpec): Entity {
  const resources = new Map<bigint, number>();
  for (const { resource, count } of o.resources ?? []) resources.set(resource.oid, count);
  if (resources.size === 0) {
    const first = rootList(p, "m_vpResources")[0];
    if (first) resources.set(first.oid, 1);
  }
  const rates: [FieldValue, FieldValue][] = [];
  for (const r of o.rates ?? []) {
    if (!(r.rate > 0)) fail("PRODUCTION_RATE_LESS_THAN_OR_EQUAL_ZERO");
    if ((r.unitPrice ?? 0) < 0) fail("NEGATIVE_UNIT_PRICE");
    rates.push([fvRef(r.type.oid), fvTuple(fvDbl(r.rate), fvDbl(r.unitPrice ?? 0))]);
  }
  const g = p.create("WorkGroup", [
    ...kernel(o.name ?? "", o.longName ?? ""), u32(204, 0xffff),
    fld(212, mapValue(FT.POINTER64, FT.SINT, [...resources].map(([r, n]) => [fvRef(r), fvInt(n)] as [FieldValue, FieldValue]))),
    fld(213, mapValue(FT.POINTER64, FT.TUPLE, rates)),
    ref(214, o.haulResource?.oid ?? null),
  ]);
  appendRef(projectRoot(p), "m_vpWorkGroups", g.oid);
  for (const t of allTasks(p)) selectSuitableWorkGroups(p, t);
  return g;
}

/**
 * `WorkSite::IsSuitable(equipe, uso)@0x9404b0` [O U-61e, AL-MOT-60]: `NullWorkGroup` serve sempre; senão a equipe serve
 * se, para algum tipo de `GetWorkTypes(uso)` (vslot +0x30), `WorkGroup::vslot+0x20(tipo)` (tem taxa) é verdadeiro.
 * `IsSuitable(equipe)@0x940440` = qualquer uso (1, 2, OTHER). Igual a `Scheduler.isSuitableGroup`.
 */
function typesForUsage(p: Project, t: Entity, usage: number): bigint[] {
  const one = (m: string) => {
    const v = asRef(t.get(m));
    return v === null ? [] : [v];
  };
  if (usage === 8) return one("m_pWorkType");
  if (usage === 2) return one("m_pDestLandType");
  if (t.members().includes("m_pSourceLandType")) return one("m_pSourceLandType");
  // envio da britagem: os refinados que ela produz (`CrushingPlantHelpers::GetRefinedTypes@0x9f30a0`, engine/costs.ts);
  // envio da pilha: os materiais que o tipo de destino aceita [I]. Conferido: com esta regra a equipe gravada nos 27
  // exemplos é mantida em 462 de 462 tarefas (U-23).
  const dest = p.resolve(asRef(t.get("m_pDestLandType")));
  if (!dest) return [];
  if (t.className === "CrushingPlant") return crusherRefinedTypes(p, t).map((e) => e.oid);
  return refs(dest.get("m_vpSuitableTypes"));
}
function isSuitableGroup(p: Project, t: Entity, g: Entity, usage: number): boolean {
  if (g.className === "NullWorkGroup") return true;
  const types = typesForUsage(p, t, usage);
  return mapEntries(g, "m_rates").some(([k]) => types.includes(keyOid(k) ?? -1n));
}
/**
 * `WorkGroupPicker::SelectSuitableWorkGroups@009abf00` [O]: para cada uso da classe (`anon::GetUsages`), mantém a
 * equipe atual se `WorkSite::IsSuitable` a aceita; senão a PRIMEIRA equipe do projeto (`GetWorkGroupsBegin…End`) que
 * serve; senão a equipe nula. Chamada na criação pelo ctor da tarefa (C-04; `MassExchange@0x9f1b10` recebe o
 * `WorkGroupPicker` por parâmetro) [O ctor; I ponto exato da chamada].
 */
export function selectSuitableWorkGroups(p: Project, t: Entity): void {
  const cls = t.className as TaskClass;
  const nullGroup = rootRef(p, "m_pNullWorkGroup");
  const groups = rootList(p, "m_vpWorkGroups");
  const cur = new Map(mapEntries(t, "m_cSelectedSubWorkGroups").map(([k, v]) => [k.kind === "int" ? k.value : 0, keyOid(v)]));
  const next: [FieldValue, FieldValue][] = [];
  for (const usage of USAGES[cls] ?? []) {
    const current = cur.get(usage);
    const curGroup = current ? p.get(current) : undefined;
    const g = curGroup && isSuitableGroup(p, t, curGroup, usage) ? curGroup : groups.find((x) => isSuitableGroup(p, t, x, usage)) ?? nullGroup;
    if (g) next.push([fvInt(usage), fvRef(g.oid)]);
  }
  const before = JSON.stringify(mapEntries(t, "m_cSelectedSubWorkGroups").map(([k, v]) => [String(keyOid(k)), String(keyOid(v))]));
  const after = JSON.stringify(next.map(([k, v]) => [String(keyOid(k)), String(keyOid(v))]));
  if (before !== after) t.setRaw("m_cSelectedSubWorkGroups", mapValue(FT.SINT, FT.POINTER64, next));
}

/** Usos de equipe de uma classe de tarefa (1 envio, 2 recebimento, 8 outras) [O exemplos]. */
export const usagesOf = (t: Entity): number[] => USAGES[t.className as TaskClass] ?? [];

/**
 * Equipe de um uso da tarefa (aba Resources do `EditWorkSiteDlg`; o comando não foi lido [D]): só equipes que servem
 * ao uso (`WorkSite::IsSuitable` [I]); uso padrão = o principal (outras, senão recebimento, senão envio:
 * `WorkSiteHelpers::GetMainSWGU@0x9293e0`) [O]. Equipe sem taxa para o tipo → TASK_TYPE_IS_UNSUITABLE (62) [P a escolha
 * da mensagem]. Datas recalculadas no mesmo nível.
 */
export function setTaskCrew(p: Project, t: Entity, crew: Entity, usage?: number): void {
  if (!isTask(t)) throw new Error("not a task");
  const usages = usagesOf(t);
  const u = usage ?? [8, 2, 1].find((x) => usages.includes(x))!;
  if (!usages.includes(u)) throw new Error(`${t.className} has no crew usage ${u} (it has ${usages.join(", ")})`);
  if (!isSuitableGroup(p, t, crew, u)) fail("TASK_TYPE_IS_UNSUITABLE", `crew "${crew.name}" has no production rate for the type of "${t.name}"`);
  const next = new Map(mapEntries(t, "m_cSelectedSubWorkGroups").map(([k, v]) => [k.kind === "int" ? k.value : 0, keyOid(v)]));
  next.set(u, crew.oid);
  t.setRaw("m_cSelectedSubWorkGroups", mapValue(FT.SINT, FT.POINTER64, [...next].sort((a, b) => a[0] - b[0]).map(([k, v]) => [fvInt(k), fvRef(v)] as [FieldValue, FieldValue])));
  afterTaskChange(p);
}

// =====================================================================================================================
// Locais (§5)
// =====================================================================================================================

/** `RoadLineUISettings` novo [O construtor @0x9bb850, como em views/map/commands.ts] com a fonte do projeto [I]. */
function newLineSettings(p: Project): Entity {
  return p.create("RoadLineUISettings", [...kernel(), ref(201, newFont(p).oid), emptyMap(202), refList(203, []), i32(205, 0), dbl(206, 0.7)]);
}

/** `OrderHelper::AddItem` (ordem de desenho: `UIManager.m_pPolygonOrderHelper`, lista ligada anterior → seguinte) [O chamada, I forma]. */
function orderHelperAdd(p: Project, oid: bigint): void {
  const h = p.resolve(asRef(ui(p)?.get("m_pPolygonOrderHelper")));
  if (!h) return;
  const links = new Map(mapEntries(h, "m_mItems.left").map(([k, v]) => [keyOid(k) ?? 0n, keyOid(v) ?? 0n]));
  let last = 0n;
  const seen = new Set<bigint>();
  while (links.has(last) && links.get(last) !== 0n && !seen.has(last)) {
    seen.add(last);
    last = links.get(last)!;
  }
  links.set(last, oid);
  links.set(oid, 0n);
  h.setRaw("m_mItems.left", mapValue(FT.POINTER64, FT.POINTER64, [...links].map(([a, b]) => [fvRef(a), fvRef(b)] as [FieldValue, FieldValue])));
}
/** `OrderHelper::RemoveItem` [I]: religa anterior → seguinte. */
function orderHelperRemove(p: Project, dead: ReadonlySet<bigint>): void {
  const h = p.resolve(asRef(ui(p)?.get("m_pPolygonOrderHelper")));
  if (!h) return;
  const links = new Map(mapEntries(h, "m_mItems.left").map(([k, v]) => [keyOid(k) ?? 0n, keyOid(v) ?? 0n]));
  let changed = false;
  for (const x of dead) {
    if (!links.has(x)) continue;
    const next = links.get(x)!;
    for (const [k, v] of links) if (v === x) links.set(k, next);
    links.delete(x);
    changed = true;
  }
  if (changed) h.setRaw("m_mItems.left", mapValue(FT.POINTER64, FT.POINTER64, [...links].map(([a, b]) => [fvRef(a), fvRef(b)] as [FieldValue, FieldValue])));
}

/**
 * `Project::AddRoadLine(nome, nome longo, início, fim)@0090c6e0` → `RoadLine@008fbcc0` [O]: ribbon 36057 passa
 * ("Road line" 14569, "", 0, 5000) (`BaseView::OnNewRoadLine@004920b0`); largura 0.0, sem coordenadas, direcionalidade 0,
 * `RoadLineUISettings` novo, `OrderHelper::AddItem`. início > fim → 8; início = fim → 45 [O].
 */
export function addRoadLine(p: Project, o: { name?: string | undefined; longName?: string | undefined; begin?: number | undefined; end?: number | undefined; width?: number | undefined }): Entity {
  const begin = o.begin ?? 0, end = o.end ?? 5000;
  if (!Number.isInteger(begin) || !Number.isInteger(end)) throw new Error("road line stations are integers"); // m_nStationBegin/End são i32 [O]
  if (begin > end) fail("BEGIN_STATION_GREATER_THAN_END_STATION");
  if (begin === end) fail("ZERO_LENGTH_ROADLINE");
  if (o.width !== undefined && o.width < 0) fail("NEGATIVE_DISTANCE"); // [I] largura negativa
  const rl = p.create("RoadLine", [
    ...kernel(o.name ?? "Road line", o.longName ?? ""), refList(207, []), refList(212, []), ref(217, null), ref(216, newLineSettings(p).oid),
    i32(300, begin), i32(301, end), emptyMap(315), dbl(316, o.width ?? 0), emptyMap(317), bool(318, false), i32(319, 0),
  ]);
  appendRef(projectRoot(p), "m_vpRoadLines", rl.oid);
  orderHelperAdd(p, rl.oid);
  return rl;
}

/** Área ancestral (cadeia m_pAreaParent). */
function areaAncestors(p: Project, a: Entity | undefined): bigint[] {
  const out: bigint[] = [];
  for (let x = a; x && !out.includes(x.oid); x = p.resolve(asRef(x.get("m_pAreaParent")))) out.push(x.oid);
  return out;
}

/**
 * `Project::AddArea@0090acf0` → `Area@0092bf00` [O]: ribbon 36053 passa ("Area" 14033, "", pai = nulo); sem estacas
 * próprias (faixa 0…1); polígonos pelo mapa ou pela 13107. Cor Normal azul (`Area::m_colorDefault`, U-37) [O].
 */
export function addArea(p: Project, o: { name?: string | undefined; longName?: string | undefined; parent?: Entity | undefined }): Entity {
  if (o.parent && o.parent.className !== "Area") throw new Error("the parent of an area must be an area");
  // U-37: `Area::Area@0x92bf00` grava `m_colorDefault` = Rgb(0, 0, 255) como cor Normal (`eixos_areas_locais.md` §2) [O]
  const settings = newLineSettings(p);
  settings.setRaw("m_mColors", mapValue(FT.SINT, FT.ULONG, [[fvInt(6), encode(FT.ULONG, 0xff0000)]]));
  const a = p.create("Area", [
    ...kernel(o.name ?? "Area", o.longName ?? ""), refList(207, []), refList(212, []), ref(217, o.parent?.oid ?? null), ref(216, settings.oid),
    refList(300, []), refList(302, []), ref(303, null), emptyMap(304), refList(305, []),
  ]);
  appendRef(projectRoot(p), "m_vpAreas", a.oid);
  if (o.parent) appendRef(o.parent, "m_sAreaChildren", a.oid);
  return a;
}

/** Janela de uma interseção nova: PERMANENT, MinDate…MaxDate (`HasVariantTiming@00972db0`; exemplos 1998-01-01 … 2999-12-31) [O]. */
const PERMANENT_WINDOW = { begin: BigInt(MIN_DATE), end: BigInt(MAX_DATE) };

export interface PlaceSpec {
  location: Entity;
  station: number;
}
/**
 * Interseção (`RoadConnection`) [O]: `Project::AddRoadConnection(nome, de, estaca, para, estaca, distância, bidirecional)
 * @0090c2d0` → dois `Place` (distância 0: `logic_error` se ≠ 0) e a conexão PERMANENT, bidirecional, registrada no
 * projeto e nas duas road lines (`RoadLineBase::AddToContainer@00971ec0`). Padrão do ribbon (36055,
 * `Project::AddRoadConnection(RoadLineBase*)@0090c410`): linha principal, estaca mínima → máxima, distância 0.
 * Estaca fora da faixa do local → ROAD_CONNECTION_IS_OUT_OF_STATION_SPAN_RANGE (20) [I onde]; distância < 0 → 60 [I].
 */
export function addRoadConnection(p: Project, o: { name?: string | undefined; longName?: string | undefined; from?: PlaceSpec | undefined; to?: PlaceSpec | undefined; distance?: number | undefined; bidirectional?: boolean | undefined }): Entity {
  const main = mainRoadLine(p);
  const span = stationSpan(main);
  const from = o.from ?? { location: main, station: span.min };
  const to = o.to ?? { location: main, station: span.max };
  for (const pl of [from, to]) {
    if (!isLocation(pl.location)) throw new Error("intersection ends must be road lines or areas");
    const s = stationSpan(pl.location);
    if (!(pl.station >= s.min && pl.station <= s.max)) fail("ROAD_CONNECTION_IS_OUT_OF_STATION_SPAN_RANGE", `station ${pl.station} on "${pl.location.name}" (${s.min}…${s.max})`);
  }
  const distance = o.distance ?? 0;
  if (!(distance >= 0)) fail("DISTANCE_CANNOT_BE_NEGATIVE");
  const place = (pl: PlaceSpec) => p.create("Place", [...kernel(), dbl(201, 0), ref(203, pl.location.oid), dbl(204, pl.station)]);
  const pf = place(from), pt = place(to);
  const rc = p.create("RoadConnection", [
    ...kernel(o.name ?? "", o.longName ?? ""),
    ref(200, null), ref(201, null), i32(202, 0), i32(203, 0), i64(204, PERMANENT_WINDOW.begin), i64(205, PERMANENT_WINDOW.end),
    ref(206, asRef(projectRoot(p).get("m_pScheduleManager"))),
    dbl(201, distance), ref(202, pf.oid), ref(203, pt.oid), ref(205, null), bool(206, o.bidirectional ?? true),
  ]);
  appendRef(projectRoot(p), "m_vpRoadConnections", rc.oid);
  appendRef(from.location, "m_roadConnections", rc.oid);
  appendRef(to.location, "m_roadConnections", rc.oid);
  return rc;
}

/**
 * `RoadLineBase::AddUsageBreak(ScheduleManager)@00971fc0` [O]: ribbon 36058 na linha principal, nome "", estacas
 * início = fim = estaca mínima, janela MinDate…MaxDate validada por `ValidateCalendarDayBasedTimeSpan(…, true, true)`
 * (fica a janela do projeto). Tempo STATIC (1) nas duas pontas [I, HasVariantTiming@00972bc0]. Estacas fora da road
 * line → USAGE_BREAK_IS_OUT_OF_STATION_SPAN_RANGE (21) [I onde]. Layout: `MakeLayout@0x984060` = cinza (199, 199, 199), largura 1 [O U-39].
 */
export function addUsageBreak(p: Project, o: { name?: string | undefined; longName?: string | undefined; roadLine?: Entity | undefined; begin?: number | undefined; end?: number | undefined; from?: bigint | undefined; to?: bigint | undefined }): Entity {
  const rl = o.roadLine ?? mainRoadLine(p);
  if (!isLocation(rl)) throw new Error("a usage break belongs to a road line or area");
  const s = stationSpan(rl);
  const b = o.begin ?? s.min, e = o.end ?? b;
  if (!Number.isInteger(b) || !Number.isInteger(e)) throw new Error("usage break stations are integers"); // f300/f301 i32 [O]
  if (b > e) fail("BEGIN_STATION_GREATER_THAN_END_STATION");
  if (b < s.min || e > s.max) fail("USAGE_BREAK_IS_OUT_OF_STATION_SPAN_RANGE", `${b}…${e} on "${rl.name}" (${s.min}…${s.max})`);
  const w = timeSpan(p, o.from ?? BigInt(MIN_DATE), o.to ?? BigInt(MAX_DATE));
  const u = p.create("UsageBreak", [
    ...kernel(o.name ?? "", o.longName ?? ""),
    ref(200, null), ref(201, null), i32(202, 1), i32(203, 1), i64(204, w.begin), i64(205, w.end), ref(206, asRef(projectRoot(p).get("m_pScheduleManager"))),
    i32(300, b), i32(301, e), ref(304, rl.oid), ref(312, newLayout(p, 0xc7c7c7, 1).oid),
  ]);
  appendRef(rl, "m_usageBreaks", u.oid);
  return u;
}

/** `ScheduleManager::ValidateCalendarDayBasedTimeSpan(…, true, true)@009809b0` dentro da janela do projeto [O]. */
function timeSpan(p: Project, from: bigint, to: bigint): { begin: bigint; end: bigint } {
  try {
    const r = validateCalendarDayBasedTimeSpan(Number(projectBegin(p)), Number(projectDeadline(p)), Number(from), Number(to), true, true);
    return { begin: BigInt(r.begin), end: BigInt(r.end) };
  } catch (e) {
    if (e instanceof TimeSpanError) fail("BEGIN_TIME_GREATER_THAN_END_TIME");
    throw e;
  }
}

// =====================================================================================================================
// Sum task, filtro, marco (§4)
// =====================================================================================================================

const sumTaskAncestors = (p: Project, s: Entity | undefined): bigint[] => {
  const out: bigint[] = [];
  for (let x = s; x && !out.includes(x.oid); x = p.resolve(asRef(x.get("m_pParent")))) out.push(x.oid);
  return out;
};
const sumTaskContainer = (p: Project, s: Entity) => need(p.resolve(asRef(s.get("m_pWorkSiteContainer"))), "WorkSiteContainer");

/** `WorkSite::SetSumTaskParent@00943760` [O]: sai do contêiner da sum task antiga e entra no da nova. */
export function setTaskSumTask(p: Project, t: Entity, st: Entity): void {
  const old = p.resolve(asRef(t.get("m_pSumTaskParent")));
  const list = CONTAINER_LIST[t.className as TaskClass];
  if (old?.oid === st.oid) return;
  if (old) removeRef(sumTaskContainer(p, old), list, t.oid);
  appendRef(sumTaskContainer(p, st), list, t.oid);
  t.set("m_pSumTaskParent", st.oid);
}

// =====================================================================================================================
// U-36: tipos, filtros/marcos, interseções e usage breaks (`tipos_filtros_intersecoes.md`)
// =====================================================================================================================

/** `Project::GetMassUnits@0x90eb80` = [corte, britagem, aterro, transporte] (sem repetir a mesma `Unit`) [O]. */
export function massUnitList(p: Project): Entity[] {
  const mu = massUnits(p);
  return [mu.cut, mu.crush, mu.fill, mu.haul].filter((u, i, a) => a.findIndex((x) => x.oid === u.oid) === i);
}
/**
 * `WorkSiteType::SetUnit@0x994440` / `SourceLandType::SetUnit@0x947ac0` [O §1.2]: no tipo de origem, as conversões são
 * reescritas para a base nova (sem conversão da base antiga para a nova → "invalid conversion" → erro inesperado, nada muda).
 */
export function setTypeUnit(t: Entity, unit: Entity): void {
  const old = asRef(t.get("m_pUnit"));
  if (old === unit.oid) return;
  if (t.className === "SourceLandType") {
    const conv = new Map(mapEntries(t, "m_conversions").map(([k, v]) => [keyOid(k)!, v.kind === "float" ? v.value : 0]));
    if (conv.size) {
      const cn = conv.get(unit.oid);
      if (cn === undefined || !(cn > 0)) fail("UNEXPECTED_ERROR", "invalid conversion");
      const next = new Map<bigint, number>();
      for (const [u, c] of conv) if (u !== unit.oid) next.set(u, c / cn!);
      if (old !== null) next.set(old, 1 / cn!);
      t.setRaw("m_conversions", mapValue(FT.POINTER64, FT.DOUBLE, [...next].map(([u, c]) => [fvRef(u), fvDbl(c)] as [FieldValue, FieldValue])));
    }
  }
  t.set("m_pUnit", unit.oid);
}
/** Conversões do tipo de origem (unidade → coeficiente: 1 unidade do tipo = c da outra) [I §1.4.1]. */
export const typeConversions = (p: Project, t: Entity): { unit: Entity; coeff: number }[] =>
  mapEntries(t, "m_conversions").map(([k, v]) => ({ unit: p.get(keyOid(k) ?? -1n), coeff: v.kind === "float" ? v.value : 0 })).filter((x): x is { unit: Entity; coeff: number } => !!x.unit);
/** `RemoveConversionCommand@0x6bbe50` [O]. */
export function removeConversion(t: Entity, unit: Entity): void {
  t.setRaw("m_conversions", mapValue(FT.POINTER64, FT.DOUBLE, mapEntries(t, "m_conversions").filter(([k]) => keyOid(k) !== unit.oid)));
}
/** `SourceLandType::SetRefiningPrice@0x9479e0` [O]: só se o destino é adequado; 0 apaga [I codificação do mapa]. */
export function setRefiningPrice(src: Entity, dest: Entity, price: number): void {
  if (!refs(src.get("m_vpSuitableTypes")).includes(dest.oid)) return;
  const entries = mapEntries(src, "m_mRefiningPrices").filter(([k]) => keyOid(k) !== dest.oid);
  if (price !== 0) entries.push([fvRef(dest.oid), fvDbl(price)]);
  src.setRaw("m_mRefiningPrices", mapValue(FT.POINTER64, FT.DOUBLE, entries));
}
export const refiningPrice = (src: Entity, dest: Entity): number => {
  const hit = mapEntries(src, "m_mRefiningPrices").find(([k]) => keyOid(k) === dest.oid)?.[1];
  return hit?.kind === "float" ? hit.value : 0;
};
/** `AddRefinedTypeCommand` / `RemoveRefinedTypeCommand` [O]. */
export function setRefinedType(src: Entity, refined: Entity, on: boolean): void {
  if (on) appendRef(src, "m_vpRefinedTypes", refined.oid);
  else removeRef(src, "m_vpRefinedTypes", refined.oid);
}

/** Dependências tipo → tipo de um lado (predecessoras: o tipo é o sucessor), por nome [O §1.3]. */
export function typeDependencies(p: Project, t: Entity, side: "predecessors" | "successors"): { other: Entity; delay: number; dep: Entity }[] {
  const me = side === "predecessors" ? "m_pSuccessor" : "m_pPredecessor", them = side === "predecessors" ? "m_pPredecessor" : "m_pSuccessor";
  return refs(t.get("m_vpDependencies")).map((o) => p.get(o)).filter((d): d is Entity => d?.className === "TypeDependency" && asRef(d.get(me)) === t.oid)
    .map((dep) => ({ dep, other: p.get(asRef(dep.get(them)) ?? -1n)!, delay: num(dep.get("m_nDelayDays")) ?? 0 })).filter((x) => !!x.other).sort((a, b) => byNameOf(a.other, b.other));
}
const byNameOf = (a: Entity, b: Entity) => a.name.localeCompare(b.name, undefined, { numeric: true });
/** `WorkSiteType::IsPrecededBy(a, b, recursivo)` [O]: a precede b por alguma cadeia. */
function isPrecededBy(p: Project, a: Entity, b: Entity, seen = new Set<bigint>()): boolean {
  if (seen.has(b.oid)) return false;
  seen.add(b.oid);
  return typeDependencies(p, b, "predecessors").some((x) => x.other.oid === a.oid || isPrecededBy(p, a, x.other, seen));
}
/** Todos os tipos do projeto (origem, destino, tarefa). */
export const allTypeList = (p: Project): Entity[] => allTypes(p);
/**
 * `GetPossibleTypes@0x6b8520` [O; lado I]: todos os tipos menos o próprio, os que fechariam ciclo e os já ligados
 * diretamente, por nome.
 */
export function possibleDependencyTypes(p: Project, t: Entity, side: "predecessors" | "successors"): Entity[] {
  const linked = new Set(typeDependencies(p, t, side).map((x) => x.other.oid));
  return allTypes(p).filter((x) => x.oid !== t.oid && !linked.has(x.oid) && !(side === "predecessors" ? isPrecededBy(p, t, x) : isPrecededBy(p, x, t))).sort(byNameOf);
}
/** `WorkSiteType::AddPredecessor/AddSuccessor` [O]: ciclo → nada, sem mensagem; senão cria ou acerta o atraso. */
export function addTypeLink(p: Project, t: Entity, side: "predecessors" | "successors", other: Entity, delay: number): void {
  const [pred, succ] = side === "predecessors" ? [other, t] : [t, other];
  if (isPrecededBy(p, succ, pred)) return;
  addTypeDependency(p, pred, succ, Math.trunc(delay));
}
/** `WorkSiteType::RemoveDependency@0x9941a0` [O]: tira dos dois lados e destrói o `TypeDependency`. */
export function removeTypeLink(p: Project, dep: Entity): void {
  for (const k of ["m_pPredecessor", "m_pSuccessor"]) {
    const t = p.get(asRef(dep.get(k)) ?? -1n);
    if (t) removeRef(t, "m_vpDependencies", dep.oid);
  }
  p.remove(dep);
}

/** Lado "início"/"fim" de um `HasVariantTiming` (interseção, usage break) [O §3.2]: 0 PERMANENT, 1 STATIC, 2 TASK. */
export interface VariantSide { type: 0 | 1 | 2; date?: bigint | undefined; task?: Entity | undefined }
/**
 * `ApplyChanges` do 13093/13072 [O §3.2]: Always active → os dois PERMANENT; dois Time → `SetTiming` (fim < início → 1);
 * misto → cada lado (`SetBeginTime`/`SetDependentBeginWorkSite`…); os lados STATIC são normalizados ao dia e presos ao projeto.
 */
export function setVariantTiming(p: Project, e: Entity, begin: VariantSide, end: VariantSide): void {
  if (begin.type === 0 || end.type === 0) {
    e.set("m_beginTimingType", 0); e.set("m_endTimingType", 0);
    e.set("m_pBeginWorkSite", null); e.set("m_pEndWorkSite", null);
    return;
  }
  const b = begin.type === 1 ? begin.date ?? (e.get("m_beginDate") as bigint) : undefined;
  const en = end.type === 1 ? end.date ?? (e.get("m_endDate") as bigint) : undefined;
  if (b !== undefined && en !== undefined) {
    const w = timeSpan(p, b, en);
    e.set("m_beginDate", w.begin); e.set("m_endDate", w.end);
  } else {
    const pb = Number(projectBegin(p)), pe = Number(projectDeadline(p));
    if (b !== undefined) e.set("m_beginDate", BigInt(validateCalendarDayBasedTimeSpan(pb, pe, Number(b), Number(e.get("m_endDate") ?? b), true, false).begin));
    if (en !== undefined) e.set("m_endDate", BigInt(validateCalendarDayBasedTimeSpan(pb, pe, Number(e.get("m_beginDate") ?? en), Number(en), false, true).end));
  }
  e.set("m_beginTimingType", begin.type); e.set("m_endTimingType", end.type);
  e.set("m_pBeginWorkSite", begin.type === 2 ? begin.task?.oid ?? null : null);
  e.set("m_pEndWorkSite", end.type === 2 ? end.task?.oid ?? null : null);
}

/**
 * `RoadConnection::SetConnection@0x9bcc00` [O §3.1.1]: as duas pontas (estacas inteiras presas ao local, sem mensagem),
 * comprimento (< 0 → 22) e two-way num comando ("Edit intersection" 14566); tudo igual → nada.
 */
export function setRoadConnection(p: Project, rc: Entity, o: { from?: PlaceSpec; to?: PlaceSpec; distance?: number; bidirectional?: boolean }): void {
  const placeOf = (k: string) => p.get(asRef(rc.get(k)) ?? -1n)!;
  const pf = placeOf("m_pPlaceFrom"), pt = placeOf("m_pPlaceTo");
  const cur = (pl: Entity): PlaceSpec => ({ location: p.get(asRef(pl.get("m_pRoadLine")) ?? -1n)!, station: num(pl.get("m_dStation")) ?? 0 });
  const clampSpec = (s: PlaceSpec): PlaceSpec => { const sp = stationSpan(s.location); return { location: s.location, station: Math.min(Math.max(Math.trunc(s.station), sp.min), sp.max) }; };
  const from = clampSpec(o.from ?? cur(pf)), to = clampSpec(o.to ?? cur(pt));
  const distance = Math.trunc(o.distance ?? (num(rc.get("m_dDistance")) ?? 0));
  if (distance < 0) fail("NEGATIVE_LENGTH");
  for (const [pl, s] of [[pf, from], [pt, to]] as const) {
    const was = asRef(pl.get("m_pRoadLine"));
    if (was !== s.location.oid) {
      const old = p.get(was ?? -1n);
      if (old) removeRef(old, "m_roadConnections", rc.oid);
      appendRef(s.location, "m_roadConnections", rc.oid);
      pl.set("m_pRoadLine", s.location.oid);
    }
    pl.set("m_dStation", s.station);
  }
  rc.set("m_dDistance", distance);
  if (o.bidirectional !== undefined) rc.set("m_bBidirectional", o.bidirectional);
}
/** `RoadConnection::MakeName@0x9bc9a0` [O]: nome vazio → "A ↔ B" (two-way) ou "A → B". */
export function roadConnectionName(p: Project, rc: Entity): string {
  if (rc.name) return rc.name;
  const end = (k: string) => p.get(asRef(p.get(asRef(rc.get(k)) ?? -1n)?.get("m_pRoadLine")) ?? -1n)?.name ?? "";
  return `${end("m_pPlaceFrom")} ${rc.get("m_bBidirectional") === false ? "→" : "↔"} ${end("m_pPlaceTo")}`;
}

/** `UsageBreak::SetRoadLine@0x984220` [O §4.1]: estacas inteiras; fim < início → 8; fora do local → 21. */
export function setUsageBreakPlace(p: Project, ub: Entity, loc: Entity, b: number, e: number): void {
  const s = stationSpan(loc);
  b = Math.trunc(b); e = Math.trunc(e);
  if (e < b) fail("BEGIN_STATION_GREATER_THAN_END_STATION");
  if (b < s.min || e > s.max) fail("USAGE_BREAK_IS_OUT_OF_STATION_SPAN_RANGE");
  const was = asRef(ub.get("m_pRoadLine"));
  if (was !== loc.oid) {
    const old = p.get(was ?? -1n);
    if (old) removeRef(old, "m_usageBreaks", ub.oid);
    appendRef(loc, "m_usageBreaks", ub.oid);
    ub.set("m_pRoadLine", loc.oid);
  }
  ub.set("m_nStationBegin", b);
  ub.set("m_nStationEnd", e);
}

/**
 * Datas do marco (`Milestone::SetBeginTime/SetEndTime` → `ValidateCalendarDayBasedTimeSpan(…, true, true)`) [O §2.4]:
 * início antes, cada um validado contra o outro valor ainda antigo; falha → 1 (14055).
 */
export function setMilestoneDates(p: Project, m: Entity, begin?: bigint, end?: bigint): void {
  if (begin !== undefined) {
    const w = timeSpan(p, begin, m.get("m_endDate") as bigint);
    m.set("m_beginDate", w.begin); m.set("m_endDate", w.end);
  }
  if (end !== undefined) {
    const w = timeSpan(p, m.get("m_beginDate") as bigint, end);
    m.set("m_beginDate", w.begin); m.set("m_endDate", w.end);
  }
}

/** Critérios do filtro (13086) [O §2.3]: tipos e recursos (conjuntos) e locais (mapa local → (início, fim)). */
export function setFilterMember(f: Entity, list: "m_spWorkSiteTypes" | "m_spResources", oid: bigint, on: boolean): void {
  const cur = refs(f.get(list)).filter((o) => o !== oid);
  f.setRaw(list, encodeContainer(FT.POINTER64, on ? [...cur, oid] : cur));
}
export function filterLocations(f: Entity): Map<bigint, [number, number]> {
  return new Map(mapEntries(f, "m_mLocations").map(([k, v]) => {
    const [a, b] = v.kind === "tuple" ? v.items : [];
    return [keyOid(k)!, [a?.kind === "float" ? a.value : 0, b?.kind === "float" ? b.value : 0]] as [bigint, [number, number]];
  }));
}
/** `WorkSiteFilter::SetStationSpan@0x9778a0` / `RemoveLocation` [O]: road line com fim < início → 8; área → faixa (0, 1). */
export function setFilterLocation(f: Entity, loc: Entity, span: [number, number] | null): void {
  const m = filterLocations(f);
  if (span === null) m.delete(loc.oid);
  else {
    if (loc.className === "RoadLine" && span[1] < span[0]) fail("BEGIN_STATION_GREATER_THAN_END_STATION");
    m.set(loc.oid, loc.className === "Area" ? [0, 1] : span);
  }
  f.setRaw("m_mLocations", mapValue(FT.POINTER64, FT.TUPLE, [...m].map(([o, [a, b]]) => [fvRef(o), fvTuple(fvDbl(a), fvDbl(b))] as [FieldValue, FieldValue])));
}

// =====================================================================================================================
// U-35: recursos, veículos, equipes e custos de transporte (`recursos_equipes_custos.md`)
// =====================================================================================================================

/** `Resource::GetQuantityRestriction(st, herdar)@0x974340` [O]: o limite próprio; com `inherit`, sobe pelos pais; sem nada → 0. */
export function quantityRestriction(p: Project, r: Entity, st: Entity, inherit: boolean): number {
  const own = new Map(mapEntries(r, "m_mQuantityRestrictions").map(([k, v]) => [keyOid(k), v.kind === "int" ? v.value : 0]));
  for (let s: Entity | undefined = st; s; s = inherit ? p.resolve(asRef(s.get("m_pParent"))) : undefined) {
    const n = own.get(s.oid);
    if (n !== undefined) return n;
    if (!inherit) break;
  }
  return 0;
}
/** `Resource::SetQuantityRestriction(st, n)@0x9745c0` [O]: n < 1 apaga a entrada (sem limite); senão grava ("Set quantity constraint" 14533). */
export function setQuantityRestriction(r: Entity, st: Entity, n: number): void {
  const entries = mapEntries(r, "m_mQuantityRestrictions").filter(([k]) => keyOid(k) !== st.oid);
  if (n >= 1) entries.push([fvRef(st.oid), fvInt(Math.trunc(n))]);
  r.setRaw("m_mQuantityRestrictions", mapValue(FT.POINTER64, FT.SINT, entries));
}

/** Tabela distância → taxa do veículo (`m_mDistanceWorkAchievement`, mapa ordenado por distância). */
export function transporterRates(t: Entity): [number, number][] {
  return mapEntries(t, "m_mDistanceWorkAchievement").map(([k, v]) => [k.kind === "float" ? k.value : 0, v.kind === "float" ? v.value : 0] as [number, number]).sort((a, b) => a[0] - b[0]);
}
function writeRates(t: Entity, rows: Iterable<[number, number]>): void {
  t.setRaw("m_mDistanceWorkAchievement", mapValue(FT.DOUBLE, FT.DOUBLE, [...rows].sort((a, b) => a[0] - b[0]).map(([d, w]) => [fvDbl(d), fvDbl(w)] as [FieldValue, FieldValue])));
}
/** `Transporter::CalculateRate@0x99cca0` [O]: interpolação harmônica (a mesma de RN-008). */
const calculateRate = (d1: number, w1: number, d2: number, w2: number, d: number) => (w1 === w2 ? w1 : ((d2 - d1) * w1 * w2) / ((d - d1) * w1 + (d2 - d) * w2));
/** `Transporter::CalculateDistance@0x99cc10` [O]. */
const calculateDistance = (d1: number, w1: number, d2: number, w2: number, w: number) => (w1 === w2 ? (d1 + d2) / 2 : ((w - w2) * d1 * w1 + (w1 - w) * d2 * w2) / ((w1 - w2) * w));

/**
 * `Transporter::AddRate(optional d, optional w)@0x99c3b0` [O §3.2]: com os dois, grava (d < 0 → 23; w ≤ 0 → 24); só d
 * ou só w completam pela tabela (vazia: 2500 m e 5 × capacidade; 1 ponto: 0,8/1,25 e 0,5/2; ≥ 2: harmônica com os
 * vizinhos); nenhum estende a tabela depois do último ponto ("Set production rates" 14721).
 */
export function addTransporterRate(t: Entity, d?: number, w?: number): void {
  const rows = transporterRates(t);
  const cap = num(t.get("m_dCapacity")) ?? 0;
  const seg = <T>(x: number, key: (r: [number, number]) => number, pick: (a: [number, number], b: [number, number]) => T): T => {
    for (let i = 0; i + 1 < rows.length; i++) {
      const lo = Math.min(key(rows[i]!), key(rows[i + 1]!)), hi = Math.max(key(rows[i]!), key(rows[i + 1]!));
      if (x >= lo && x <= hi) return pick(rows[i]!, rows[i + 1]!);
    }
    return x < key(rows[0]!) === (key(rows[0]!) <= key(rows[rows.length - 1]!)) ? pick(rows[0]!, rows[1]!) : pick(rows[rows.length - 2]!, rows[rows.length - 1]!);
  };
  if (d === undefined && w === undefined) {
    if (rows.length === 0) [d, w] = [2500, 5 * cap];
    else if (rows.length === 1) [d, w] = [2 * rows[0]![0], 0.8 * rows[0]![1]];
    else {
      const [a, b] = [rows[rows.length - 2]!, rows[rows.length - 1]!];
      d = b[0] + (b[0] - a[0]);
      w = calculateRate(a[0], a[1], b[0], b[1], d);
    }
  } else if (w === undefined) {
    if (rows.length === 0) w = 5 * cap;
    else if (rows.length === 1) {
      const [d0, w0] = rows[0]!;
      if (d === d0) return;
      w = d! > d0 ? 0.8 * w0 : 1.25 * w0;
    } else w = seg(d!, (r) => r[0], (a, b) => calculateRate(a[0], a[1], b[0], b[1], d!));
  } else if (d === undefined) {
    if (rows.length === 0) d = 2500;
    else if (rows.length === 1) {
      const [d0, w0] = rows[0]!;
      if (w === w0) return;
      d = w > w0 ? 0.5 * d0 : 2 * d0;
    } else d = seg(w, (r) => r[1], (a, b) => calculateDistance(a[0], a[1], b[0], b[1], w!));
  }
  if (!(d! >= 0)) fail("NEGATIVE_DISTANCE");
  if (!(w! > 0)) fail("PRODUCTION_RATE_LESS_THAN_OR_EQUAL_ZERO");
  const next = new Map(rows);
  next.set(d!, w!);
  writeRates(t, next);
}
/** `Transporter::RemoveRate(d)@0x99d550` [O]. */
export function removeTransporterRate(t: Entity, d: number): void {
  writeRates(t, transporterRates(t).filter(([x]) => x !== d));
}
/** `Transporter::SetCapacity@0x99d610` [O §3.1]: ≤ 0 → 2; as taxas × (nova ÷ antiga), as rotações por hora não mudam ("Set capacity" 14078). */
export function setTransporterCapacity(t: Entity, cap: number): void {
  const old = num(t.get("m_dCapacity")) ?? 0;
  if (cap === old) return;
  if (!(cap > 0)) fail("QUANTITY_HAS_TO_BE_GREATER_THAN_ZERO");
  if (old > 0) writeRates(t, transporterRates(t).map(([d, w]) => [d, (w * cap) / old] as [number, number]));
  t.set("m_dCapacity", cap);
}
/** `Transporter::IsSuitableRoute` = não está em `m_unsuitableRoutes` [O §3.4]. */
export const isRouteSuitable = (t: Entity, route: Entity): boolean => !refs(t.get("m_unsuitableRoutes")).includes(route.oid);
/** `Transporter::SetSuitableRoute@0x99d920` [O]: desmarcar põe a rota no conjunto ("Set route suitability" 14808). */
export function setRouteSuitable(t: Entity, route: Entity, suitable: boolean): void {
  const cur = refs(t.get("m_unsuitableRoutes")).filter((o) => o !== route.oid);
  t.setRaw("m_unsuitableRoutes", encodeContainer(FT.POINTER64, suitable ? cur : [...cur, route.oid]));
}

/** `WorkGroup::m_nPriceCalculation`: bit 1 From resources, bit 2 From quantities; cada caixa mexe só no seu bit ("Change basis of costs" 14510) [O §4.1]. */
export function setPriceCalculationBit(g: Entity, bit: 1 | 2, on: boolean): void {
  const m = num(g.get("m_nPriceCalculation")) ?? 0xffff;
  g.set("m_nPriceCalculation", on ? m | bit : m & ~bit);
}
/** `WorkGroup::SetResourceCount@0x992c50` [O]: n < 1 retira o recurso da equipe ("Set resource quantity" 14560). */
export function setResourceCount(g: Entity, r: Entity, n: number): void {
  const entries = mapEntries(g, "m_resources").filter(([k]) => keyOid(k) !== r.oid);
  if (n >= 1) entries.push([fvRef(r.oid), fvInt(Math.trunc(n))]);
  g.setRaw("m_resources", mapValue(FT.POINTER64, FT.SINT, entries));
}
/** Recursos da equipe (recurso → quantidade). */
export const crewResources = (p: Project, g: Entity): { resource: Entity; count: number }[] =>
  mapEntries(g, "m_resources").map(([k, v]) => ({ resource: p.get(keyOid(k) ?? -1n), count: v.kind === "int" ? v.value : 0 })).filter((x): x is { resource: Entity; count: number } => !!x.resource);
/** `WorkGroup::RemoveType@0x992710` [O]: tira a taxa do tipo ("Set production rates" 14721). */
export function removeCrewType(g: Entity, type: Entity): void {
  g.setRaw("m_rates", mapValue(FT.POINTER64, FT.TUPLE, mapEntries(g, "m_rates").filter(([k]) => keyOid(k) !== type.oid)));
}
/** Taxas da equipe na ordem gravada (o original segue a ordem do `unordered_map` [I], R-1). */
export function crewRates(p: Project, g: Entity): { type: Entity; rate: number; unitPrice: number }[] {
  return mapEntries(g, "m_rates").map(([k, v]) => {
    const type = p.get(keyOid(k) ?? -1n);
    const [r, u] = v.kind === "tuple" ? v.items : [];
    return type ? { type, rate: r?.kind === "float" ? r.value : 0, unitPrice: u?.kind === "float" ? u.value : 0 } : undefined;
  }).filter((x): x is { type: Entity; rate: number; unitPrice: number } => !!x);
}

/** `PriceVector::RemovePriceAtDistance` [O]: tira o ponto ("Haul cost" 14513). */
export function removePriceAtDistance(pv: Entity, distance: number): void {
  pv.setRaw("m_distances", mapValue(FT.DOUBLE, FT.DOUBLE, mapEntries(pv, "m_distances").filter(([k]) => !(k.kind === "float" && k.value === distance))));
}
/** Pontos do custo de transporte (distância → custo), por distância. */
export function priceVectorPoints(pv: Entity): [number, number][] {
  return mapEntries(pv, "m_distances").map(([k, v]) => [k.kind === "float" ? k.value : 0, v.kind === "float" ? v.value : 0] as [number, number]).sort((a, b) => a[0] - b[0]);
}

// =====================================================================================================================
// U-33b: abas Location, Hauls e Resources do Task Properties (`tarefa_dialogo.md` §2–§4)
// =====================================================================================================================

/** Construtor de `Location@0x9ba990` [O]: as validações de `makeLocation`, com os valores já ajustados. */
function checkLocation(rl: Entity, b: number, c: number, e: number, d: number): void {
  const s = stationSpan(rl);
  if (b === e) fail("ZERO_LENGTH_LOCATION");
  if (b > e) fail("BEGIN_STATION_GREATER_THAN_END_STATION");
  if (c > e) fail("CENTER_STATION_GREATER_THAN_END_STATION");
  if (c < b) fail("CENTER_STATION_SMALLER_THAN_BEGIN_STATION");
  if (b < s.min) fail("BEGIN_STATION_SMALLER_THAN_LOCATION_BEGIN_STATION");
  if (e > s.max) fail("END_STATION_GREATER_THAN_LOCATION_END_STATION");
  if (d < 0) fail("DISTANCE_CANNOT_BE_NEGATIVE");
}
/** `WorkPlace::SetLocation@0x936990`: o novo trecho não pode cruzar outro work place da tarefa (47) [O]. */
function checkSiblings(p: Project, t: Entity, wp: Entity | null, rl: Entity, b: number, e: number): void {
  for (const o of workPlacesOf(p, t)) {
    if (o.oid === wp?.oid) continue;
    const l = locationOf(p, o);
    if (l && asRef(l.get("m_pRoadLine")) === rl.oid && b < (num(l.get("m_dStationEnd")) ?? 0) && (num(l.get("m_dStationBegin")) ?? 0) < e) fail("WORK_PLACES_CANNOT_INTERSECT");
  }
}

/**
 * `WorkPlace::SetStationBegin@0x936b80` / `SetStationEnd@0x936ea0` / `SetStationCOG@0x936ca0` / `SetDistance@0x9368c0`
 * [O §2.3]: início ≥ fim → fim = início + 1 (e o simétrico), com o centro de volta ao meio; centro fora do trecho
 * desliza o work place inteiro (comprimento mantido) preso à road line; depois as validações do `Location`.
 * [I] o `Location` é alterado no lugar (o original cria outro e o aplica por `SetLocation`).
 */
export function setWorkPlaceStation(p: Project, wp: Entity, which: "begin" | "end" | "center" | "offset", v: number): void {
  const loc = need(locationOf(p, wp), "Location");
  const rl = need(p.resolve(asRef(loc.get("m_pRoadLine"))), "road line");
  let b = num(loc.get("m_dStationBegin")) ?? 0, c = num(loc.get("m_dStationCOG")) ?? 0, e = num(loc.get("m_dStationEnd")) ?? 0, d = num(loc.get("m_dDistance")) ?? 0;
  if (which === "begin") {
    b = v;
    if (b >= e) e = b + 1;
    c = (b + e) / 2;
  } else if (which === "end") {
    e = v;
    if (e <= b) b = e - 1;
    c = (b + e) / 2;
  } else if (which === "center") {
    if (v >= b && v <= e) c = v;
    else {
      const len = e - b, s = stationSpan(rl);
      b = Math.min(Math.max(v - len / 2, s.min), s.max - len);
      e = b + len;
      c = Math.min(Math.max(v, b), e);
    }
  } else d = v;
  checkLocation(rl, b, c, e, d);
  const t = p.resolve(asRef(wp.get("m_pWorkSite")));
  if (t) checkSiblings(p, t, wp, rl, b, e);
  loc.set("m_dStationBegin", b);
  loc.set("m_dStationCOG", c);
  loc.set("m_dStationEnd", e);
  loc.set("m_dDistance", d);
}

/** Células da linha nova da grade 13016 (vazias = ausentes). */
export interface NewWorkPlaceRow {
  begin?: number | undefined;
  end?: number | undefined;
  center?: number | undefined;
  offset?: number | undefined;
  source?: number | undefined;
  destination?: number | undefined;
  other?: number | undefined;
}
/**
 * `AddCreateWorkPlaceCommands@0x53c9e0` [O §2.3]: estacas pela 1.ª célula preenchida (Start S → [S, S+1]; Finish F →
 * [F−1, F]; Center C → [C−0,5, C+0,5]; nenhuma → fim P do último work place → [P, P+1]; nada → 14352); fim além da
 * road line → `SetStationSpan(rl, início, ceil(fim))` ("Add stations" 14643); depois `AddWorkPlace` ("New task
 * location" 14755) com o afastamento inteiro e as quantidades.
 */
export function addWorkPlaceFromRow(p: Project, t: Entity, row: NewWorkPlaceRow): Entity {
  const list = workPlacesOf(p, t);
  const last = list.length ? locationOf(p, list[list.length - 1]!) : undefined;
  const rl = (last ? p.resolve(asRef(last.get("m_pRoadLine"))) : undefined) ?? roadLineOfTask(p, t) ?? mainRoadLine(p);
  let b: number, e: number, c: number;
  if (row.begin !== undefined) [b, e, c] = [row.begin, row.begin + 1, row.begin + 0.5];
  else if (row.end !== undefined) [b, e, c] = [row.end - 1, row.end, row.end - 0.5];
  else if (row.center !== undefined) [b, e, c] = [row.center - 0.5, row.center + 0.5, row.center];
  else if (last) {
    const prev = num(last.get("m_dStationEnd")) ?? 0;
    [b, e, c] = [prev, prev + 1, prev + 0.5];
  } else fail("INVALID_STATIONS");
  if (rl.className === "RoadLine" && e! > stationSpan(rl).max) setStationSpan(p, rl, stationSpan(rl).min, Math.ceil(e!));
  const cls = t.className;
  const q = cls === "OtherWorkSite" ? row.other : SOURCE_AMOUNT.has(cls) && !DEST_AMOUNT.has(cls) ? row.source : !SOURCE_AMOUNT.has(cls) ? row.destination : undefined;
  return addTaskLocation(p, t, {
    location: rl, begin: b!, end: e!, center: c!, distance: Math.trunc(row.offset ?? 0),
    ...(q !== undefined ? { quantity: q } : {}),
    ...(cls === "MassExchange" ? { source: row.source ?? 0, destination: row.destination ?? 0 } : {}),
  });
}

/**
 * U-61e (AL-DLG-50, T-5) `anon::GetAdjustedSpan@0x93f3f0` [O]: faixa (b, e) da tarefa levada ao eixo (rb, re):
 * comprimento ≥ o do eixo → o eixo inteiro; já dentro → a mesma; senão deslocada para caber (b < rb → +rb − b; senão
 * +re − e), mantendo o comprimento.
 */
export function adjustedSpan(b: number, e: number, rb: number, re: number): [number, number] {
  if (e - b >= re - rb) return [rb, re];
  if (b >= rb && e <= re) return [b, e];
  const shift = b < rb ? rb - b : re - e;
  return [b + shift, e + shift];
}

/**
 * `WorkSite::SetRoadLine@0x9434f0` [O §2.1] → `MoveToRoadLine@0x940d40` [O U-61e]: de área para road line (exige um
 * work place só), o work place passa à road line inteira (centro no meio, afastamento mantido); entre road lines, a
 * faixa da tarefa (início do 1.º work place, fim do último) vai a `adjustedSpan` e **cada** work place é remapeado
 * linearmente de uma faixa à outra (`anon::GetAdjustedLocation@0x93f2c0`: início, centro e fim; afastamento mantido);
 * para área, `MoveToArea` [I: um work place só, trecho 0–1, quantidades somadas].
 */
export function setTaskLocation(p: Project, t: Entity, to: Entity): void {
  if (!isLocation(to)) throw new Error("a task location is a road line or an area");
  const wps = workPlacesOf(p, t);
  const span = stationSpan(to);
  if (to.className === "Area") {
    const [first, ...rest] = wps;
    if (!first) return;
    for (const w of rest) for (const m of ["m_dSourceAmount", "m_dDestinationAmount", "m_dAmount"]) if (w.has(m)) first.set(m, (num(first.get(m)) ?? 0) + (num(w.get(m)) ?? 0));
    if (rest.length) {
      for (const w of rest) w.set("m_pWorkSite", null);
      t.setRaw("m_vpWorkPlaces", encodeContainer(FT.POINTER64, [first.oid]));
    }
    const l = need(locationOf(p, first), "Location");
    l.set("m_pRoadLine", to.oid); l.set("m_dStationBegin", 0); l.set("m_dStationCOG", 0.5); l.set("m_dStationEnd", 1);
    return;
  }
  const fromArea = wps.length === 1 && p.resolve(asRef(locationOf(p, wps[0]!)?.get("m_pRoadLine")))?.className === "Area";
  const locs = wps.map((w) => need(locationOf(p, w), "Location"));
  if (fromArea) {
    const l = locs[0]!;
    l.set("m_pRoadLine", to.oid); l.set("m_dStationBegin", span.min); l.set("m_dStationEnd", span.max); l.set("m_dStationCOG", (span.min + span.max) / 2);
    return;
  }
  const oldB = Math.min(...locs.map((l) => num(l.get("m_dStationBegin")) ?? 0)), oldE = Math.max(...locs.map((l) => num(l.get("m_dStationEnd")) ?? 0));
  const [nB, nE] = adjustedSpan(oldB, oldE, span.min, span.max);
  const map = (x: number) => (oldE > oldB ? nB + ((x - oldB) / (oldE - oldB)) * (nE - nB) : nB);
  for (const l of locs) {
    const b = map(num(l.get("m_dStationBegin")) ?? 0), e = map(num(l.get("m_dStationEnd")) ?? 0), c = map(num(l.get("m_dStationCOG")) ?? (b + e) / 2);
    l.set("m_pRoadLine", to.oid); l.set("m_dStationBegin", b); l.set("m_dStationEnd", e); l.set("m_dStationCOG", c);
  }
}

/** `MoveManager::RemoveLPMove@0x94fc10` / `RemoveSchedMove@0x94fe10` [O]: tira os transportes das listas ("Remove haul" 14425). */
export function removeMoves(p: Project, moves: readonly Entity[]): void {
  const mm = rootRef(p, "m_pMoveManager");
  if (!mm) return;
  const gone = new Set(moves.map((m) => m.oid));
  for (const list of ["m_vpLPMoves", "m_vpSchedMoves"]) {
    const all = refs(mm.get(list));
    const keep = all.filter((o) => !gone.has(o));
    if (keep.length !== all.length) mm.setRaw(list, encodeContainer(0x18, keep));
  }
}

/** Elos de uma cadeia de transporte (origem, pilha, britagem, pilha 2, destino). */
export interface ChainLinks { source: bigint; pile?: bigint | null | undefined; crush?: bigint | null | undefined; pile2?: bigint | null | undefined; destination: bigint }
const chainId = (c: ChainLinks) => [c.source, c.pile ?? 0n, c.crush ?? 0n, c.pile2 ?? 0n, c.destination].join("|");
const preventedOf = (p: Project, k: Entity): string =>
  chainId({ source: asRef(k.get("m_candidate.m_pSource")) ?? 0n, pile: asRef(k.get("m_candidate.m_pPile")), crush: asRef(k.get("m_candidate.m_pCrush")), pile2: asRef(k.get("m_candidate.m_pPile2")), destination: asRef(k.get("m_candidate.m_pDestination")) ?? 0n });
/** A cadeia está em `MoveManager.m_preventedChains`? */
export function isChainPrevented(p: Project, c: ChainLinks): boolean {
  const mm = rootRef(p, "m_pMoveManager");
  const id = chainId(c);
  return refs(mm?.get("m_preventedChains")).some((o) => { const k = p.get(o); return !!k && preventedOf(p, k) === id; });
}
/** `MoveManager::SetHaulChainCandidatePrevented@0x9501e0` [O]: liga ou desliga a cadeia em `m_preventedChains` ("Exclude" 14276). */
export function setChainPrevented(p: Project, c: ChainLinks, prevented: boolean): void {
  const mm = need(rootRef(p, "m_pMoveManager"), "MoveManager");
  const id = chainId(c);
  const cur = refs(mm.get("m_preventedChains"));
  const hit = cur.filter((o) => { const k = p.get(o); return !!k && preventedOf(p, k) === id; });
  if (prevented && hit.length === 0) {
    const k = p.create("KernelHaulChainCandidate", [...kernel(), ref(200, c.source), ref(201, c.pile ?? null), ref(202, c.crush ?? null), ref(203, c.pile2 ?? null), ref(204, c.destination)]);
    mm.setRaw("m_preventedChains", encodeContainer(FT.POINTER64, [...cur, k.oid]));
  } else if (!prevented && hit.length) mm.setRaw("m_preventedChains", encodeContainer(FT.POINTER64, cur.filter((o) => !hit.includes(o))));
}

/** Taxa (por hora) e custo unitário da equipe para um tipo (`m_rates`), ou undefined. */
export function crewRate(g: Entity, type: Entity): { rate: number; unitPrice: number } | undefined {
  for (const [k, v] of mapEntries(g, "m_rates")) {
    if (keyOid(k) !== type.oid || v.kind !== "tuple") continue;
    const [r, u] = v.items;
    return { rate: r?.kind === "float" ? r.value : 0, unitPrice: u?.kind === "float" ? u.value : 0 };
  }
  return undefined;
}
/**
 * OK do 13036 New Crew Suitability [O §4.4]: `SetProductionRateCommand` (14721) e `SetUnitPriceCommand` (14703) por
 * tipo; taxa ≤ 0 → 24 (14518) [I: lançador em `WorkGroup::SetProductionRate`]; custo < 0 → 7.
 */
export function setCrewRates(g: Entity, rates: readonly { type: Entity; rate: number; unitPrice: number }[]): void {
  const next = new Map(mapEntries(g, "m_rates").map(([k, v]) => [String(keyOid(k)), [k, v] as [FieldValue, FieldValue]]));
  for (const r of rates) {
    if (!(r.rate > 0)) fail("PRODUCTION_RATE_LESS_THAN_OR_EQUAL_ZERO");
    if (r.unitPrice < 0) fail("NEGATIVE_UNIT_PRICE");
    next.set(String(r.type.oid), [fvRef(r.type.oid), fvTuple(fvDbl(r.rate), fvDbl(r.unitPrice))]);
  }
  g.setRaw("m_rates", mapValue(FT.POINTER64, FT.TUPLE, [...next.values()]));
}
/** Tipos de um uso da tarefa que a equipe não atende (`anon::GetTypes` do `HandleUnsuitableCrew`) [O chamada, I regra]. */
export function missingCrewTypes(p: Project, t: Entity, g: Entity, usage: number): Entity[] {
  if (g.className === "NullWorkGroup") return [];
  return typesForUsage(p, t, usage).filter((o) => !crewRate(g, need(p.get(o), "type"))).map((o) => p.get(o)!);
}
/** Tipos de um uso da tarefa (para a taxa da aba Resources). */
export function usageTypes(p: Project, t: Entity, usage: number): Entity[] {
  return typesForUsage(p, t, usage).map((o) => p.get(o)).filter((e): e is Entity => !!e);
}

/** `ProjectCommands::CreateIdentifiedResourceCommand(projeto, "", recurso)@0x5498a0` [O]: recurso identificado novo. */
export function addIdentifiedResource(p: Project, resource: Entity, name = ""): Entity {
  const r = p.create("IdentifiedResource", [...kernel(name), ref(200, resource.oid)]);
  appendRef(projectRoot(p), "m_vpIdentifiedResources", r.oid);
  return r;
}
/**
 * Recurso identificado de um uso (`m_mIdentifiedResources`, multimapa uso → IdentifiedResource) [O §4.3]: troca o
 * atual pelo novo (`ReplaceIdentifiedResourceCommand` 14316), tira (`Remove…` 14315) ou acrescenta.
 */
export function setIdentifiedResource(t: Entity, usage: number, current: bigint | null, next: bigint | null): void {
  const entries = mapEntries(t, "m_mIdentifiedResources").filter(([k, v]) => !(current !== null && (k.kind === "int" ? k.value : -1) === usage && keyOid(v) === current));
  if (next !== null) entries.push([fvInt(usage), fvRef(next)]);
  t.setRaw("m_mIdentifiedResources", mapValue(FT.SINT, FT.POINTER64, entries));
}
/** Recursos identificados escolhidos por uso. */
export function identifiedOf(t: Entity): { usage: number; resource: bigint }[] {
  return mapEntries(t, "m_mIdentifiedResources").map(([k, v]) => ({ usage: k.kind === "int" ? k.value : -1, resource: keyOid(v) ?? -1n }));
}

/** Tarefas da sum task e das sum tasks abaixo dela, na ordem dos contêineres (pré-ordem). */
export function tasksOfSumTaskDeep(p: Project, st: Entity): Entity[] {
  const out: Entity[] = [];
  const seen = new Set<bigint>();
  const walk = (s: Entity) => {
    if (seen.has(s.oid)) return;
    seen.add(s.oid);
    const c = p.resolve(asRef(s.get("m_pWorkSiteContainer")));
    if (c) for (const list of Object.values(CONTAINER_LIST)) for (const o of refs(c.get(list))) { const t = p.get(o); if (t) out.push(t); }
    for (const o of refs(s.get("m_vpChildren"))) { const k = p.get(o); if (k) walk(k); }
  };
  walk(st);
  return out;
}

/** `IsUsableFor(tarefa)` dos tipos (`IsWorkSiteTypeUsableImpl` das classes) [O]: a classe e a adequação do tipo casam. */
export function isTypeUsableFor(type: Entity, t: Entity): boolean {
  const rule = TYPE_RULES[t.className as TaskClass];
  if (!rule) return false;
  if (type.className === "SourceLandType") return rule.source !== undefined && num(type.get("m_nSuitabilityType")) === rule.source;
  if (type.className === "DestLandType") return rule.dest !== undefined && num(type.get("m_nSuitabilityType")) === rule.dest;
  return type.className === "WorkType" && !!rule.work;
}

/** `MovableWorkSite::RemoveAllMoves` [O chamada]: tira da lista do MoveManager os LPMove e SchedMove da tarefa. */
export function removeTaskMoves(p: Project, t: Entity): number {
  const mm = rootRef(p, "m_pMoveManager");
  if (!mm) return 0;
  const mine = new Set(workPlacesOf(p, t).map((w) => w.oid));
  let n = 0;
  for (const list of ["m_vpLPMoves", "m_vpSchedMoves"]) {
    const all = refs(mm.get(list));
    const keep = all.filter((o) => {
      const m = p.get(o);
      return !m || (!mine.has(m.get("m_pSrcWorkPlace") as bigint) && !mine.has(m.get("m_pDstWorkPlace") as bigint));
    });
    if (keep.length !== all.length) {
      n += all.length - keep.length;
      mm.setRaw(list, encodeContainer(0x18, keep));
    }
  }
  return n;
}

/**
 * `BorrowPit::SetSourceLandType@0x9d0f90`, `WasteLand::SetDestLandType@0x9d0370`, `OtherWorkSite::SetWorkType@0x9b7fa0`
 * [O `tarefa_dialogo.md` §1.2]: tipo inadequado → 62; apaga todos os transportes da tarefa (não no tipo de trabalho);
 * grava o tipo; o visual da tarefa volta ao do tipo; as equipes são re-escolhidas. As dependências automáticas saem do
 * postponer (o tipo é membro de AUTODEP). A quantidade não muda.
 */
export function setTaskType(p: Project, t: Entity, type: Entity): void {
  const member = type.className === "SourceLandType" ? "m_pSourceLandType" : type.className === "DestLandType" ? "m_pDestLandType" : "m_pWorkType";
  if (!t.has(member)) fail("TASK_TYPE_IS_UNSUITABLE", `${t.className} has no ${member}`);
  if (p.resolve(asRef(t.get(member)))?.oid === type.oid) return;
  if (!isTypeUsableFor(type, t)) fail("TASK_TYPE_IS_UNSUITABLE", `"${type.name}" for "${t.name}"`);
  if (member !== "m_pWorkType") removeTaskMoves(p, t);
  t.set(member, type.oid);
  t.set("m_pLayOut", copyLayout(p, type).oid);
  selectSuitableWorkGroups(p, t);
}

/**
 * `WorkSite::SetForcedBeginTiming@0x943320` / `SetForcedEndTiming@0x943400` [O]: grava data e restrição
 * (`SCT_*`/`FCT_*`); com as duas restrições ligadas, início forçado depois do fim forçado → 1 (14055).
 */
export function setForcedTiming(t: Entity, side: "begin" | "end", date: bigint, constraint: number): void {
  const [bd, bc, ed, ec] = side === "begin"
    ? [date, constraint, t.get("m_forcedEndDate") as bigint | undefined, num(t.get("m_forcedEndConstraint")) ?? 0]
    : [t.get("m_forcedBeginDate") as bigint | undefined, num(t.get("m_forcedBeginConstraint")) ?? 0, date, constraint];
  if (bc !== 0 && ec !== 0 && typeof bd === "bigint" && typeof ed === "bigint" && bd > ed) fail("BEGIN_TIME_GREATER_THAN_END_TIME");
  t.set(side === "begin" ? "m_forcedBeginDate" : "m_forcedEndDate", date);
  t.set(side === "begin" ? "m_forcedBeginConstraint" : "m_forcedEndConstraint", constraint);
}

/** Filtro temporário do "Task Selection" (`WorkSiteFilterDlg::GetWorkSiteSelection@0x69c720`): fora das listas do projeto, sem critério [O]. */
export function createTemporaryFilter(p: Project): Entity {
  return p.create("ViewFilter", filterFields(p, {}, false));
}

/** Include/Exclude do 13115 (`OnGridEndEdit@0x6a1ef0`): marcar um desmarca o outro [O]. */
export function setFilterInclusion(f: Entity, t: Entity, mode: "include" | "exclude" | "none"): void {
  for (const [list, on] of [["m_spIncludedWorkSites", mode === "include"], ["m_spExcludedWorkSites", mode === "exclude"]] as const) {
    const cur = refs(f.get(list)).filter((o) => o !== t.oid);
    f.setRaw(list, encodeContainer(0x18, on ? [...cur, t.oid] : cur));
  }
}

/** `SumTask::SetParent@00949900`: pai que é descendente → WANTED_SUM_TASK_PARENT_IS_CHILD (27) [O]. */
export function setSumTaskParent(p: Project, st: Entity, parent: Entity): void {
  if (sumTaskAncestors(p, parent).includes(st.oid)) fail("WANTED_SUM_TASK_PARENT_IS_CHILD");
  const old = p.resolve(asRef(st.get("m_pParent")));
  if (old?.oid === parent.oid) return;
  if (old) removeRef(old, "m_vpChildren", st.oid);
  appendRef(parent, "m_vpChildren", st.oid);
  st.set("m_pParent", parent.oid);
}

/**
 * `Project::CreateSumTask(nome, nome longo, zona de construção, pai, filhas…)@0090e320` → `SumTask@00948580` [O]:
 * pai padrão = raiz; layout de cor aleatória e largura 3; m_bLockInternalTiming e m_bPreventExternalHauls false;
 * comentário ""; `WorkSiteContainer` novo; as tarefas e sum tasks recebidas passam a ser filhas.
 */
export function addSumTask(p: Project, o: { name?: string | undefined; longName?: string | undefined; parent?: Entity | undefined; constructionZone?: boolean | undefined; preventExternalHauls?: boolean | undefined; tasks?: readonly Entity[] | undefined; sumTasks?: readonly Entity[] | undefined }): Entity {
  const parent = o.parent ?? rootSumTask(p);
  const c = p.create("WorkSiteContainer", [...kernel(), ...[201, 202, 203, 204, 205, 206, 207, 208].map((id) => refList(id, []))]);
  const st = p.create("SumTask", [
    ...kernel(o.name ?? "", o.longName ?? ""), refList(200, []), ref(203, c.oid), ref(206, null), bool(207, o.constructionZone ?? false), str(211, ""),
    ref(223, newLayout(p, randomColor(), 3).oid), bool(232, false), bool(233, o.preventExternalHauls ?? false),
  ]);
  setSumTaskParent(p, st, parent);
  for (const t of o.tasks ?? []) setTaskSumTask(p, t, st);
  for (const s of o.sumTasks ?? []) setSumTaskParent(p, s, st);
  return st;
}

/** Locais do projeto com a faixa de estacas (para `m_mLocations` de filtros). */
function allLocations(p: Project): Entity[] {
  return [...rootList(p, "m_vpRoadLines"), ...rootList(p, "m_vpAreas")];
}
function allTypes(p: Project): Entity[] {
  return [...rootList(p, "m_vpSourceLandTypes"), ...rootList(p, "m_vpDestLandTypes"), ...rootList(p, "m_vpWorkTypes")];
}
const locationsValue = (locs: readonly Entity[]): FieldValue =>
  mapValue(FT.POINTER64, FT.TUPLE, locs.map((l) => {
    const s = stationSpan(l);
    return [fvRef(l.oid), fvTuple(fvDbl(s.min), fvDbl(s.max))] as [FieldValue, FieldValue];
  }));

export interface FilterSpec {
  name?: string | undefined;
  longName?: string | undefined;
  tasks?: readonly Entity[] | undefined;
  types?: readonly Entity[] | undefined;
  resources?: readonly Entity[] | undefined;
}
/** Campos de `WorkSiteFilter` (ViewFilter e Milestone): 202 tipos, 203 recursos, 204 locais, 206/207 excluídas/incluídas, 210–212 flags [O]. */
function filterFields(p: Project, o: FilterSpec, fill: boolean): Field[] {
  // `WorkSiteFilterHelpers::FillEmptyCriteria@0x9766d0` [O U-61e, C-09]: tipos vazios → todos os tipos de origem e de
  // destino (`GetSourceLandTypes` + `GetDestLandTypes`; os tipos de trabalho não entram); recursos vazios → todos os
  // recursos; locais vazios → todos os eixos e áreas (`GetRoadLinesAndAreas`) com a faixa inteira (vslot +0x18).
  // `WorkSiteFilter` nasce com os três flags de filtragem desligados (ctor @0x975f30) [O].
  const types = o.types ?? (fill ? [...rootList(p, "m_vpSourceLandTypes"), ...rootList(p, "m_vpDestLandTypes")] : []);
  const resources = o.resources ?? (fill ? rootList(p, "m_vpResources") : []);
  return [
    ...kernel(o.name ?? "", o.longName ?? ""),
    refList(202, types.map((t) => t.oid)), refList(203, resources.map((r) => r.oid)), fld(204, locationsValue(fill ? allLocations(p) : [])),
    refList(206, []), refList(207, (o.tasks ?? []).map((t) => t.oid)),
    bool(210, !!o.types?.length), bool(211, !!o.resources?.length), bool(212, false),
  ];
}

/** `Project::AddViewFilter("", "", conjunto)@0090ceb0` → `ViewFilter@00982530`: flags false; conjunto vazio → FillEmptyCriteria [O]. */
export function addViewFilter(p: Project, o: FilterSpec): Entity {
  const v = p.create("ViewFilter", filterFields(p, o, !(o.tasks?.length)));
  appendRef(projectRoot(p), "m_vpViewFilters", v.oid);
  return v;
}

/**
 * `Project::AddMilestone("", "", início, fim, conjunto)@0090bd00` → `Milestone@00981d20` [O U-61e]: o ctor copia as
 * datas recebidas, inclui cada tarefa do conjunto (`IncludeWorkSite`) e valida o período "por dia"
 * (`ValidateCalendarDayBasedTimeSpan(…, true, true)`); nenhuma tarefa → `invalid_argument` ("Milestone.cpp" 0x1c).
 * Janela padrão do ribbon = início … fim do projeto [I, C-09]; critérios de tipo/recurso/local desligados (ctor do
 * `WorkSiteFilter`) [O].
 */
export function addMilestone(p: Project, o: FilterSpec & { begin?: bigint | undefined; end?: bigint | undefined }): Entity {
  const w = timeSpan(p, o.begin ?? projectBegin(p), o.end ?? projectDeadline(p));
  const m = p.create("Milestone", [...filterFields(p, o, false), i64(301, w.begin), i64(302, w.end), ref(303, asRef(projectRoot(p).get("m_pScheduleManager")))]);
  appendRef(projectRoot(p), "m_vpMilestones", m.oid);
  return m;
}

// =====================================================================================================================
// Tarefas (§3)
// =====================================================================================================================

export interface WorkPlaceSpec {
  /** road line ou área; padrão: a da tarefa */
  location?: Entity | undefined;
  begin?: number | undefined;
  center?: number | undefined;
  end?: number | undefined;
  distance?: number | undefined;
  /** quantidade principal: origem (corte, jazida), destino (aterro, bota-fora, pilha, britagem), m_dAmount (Task) */
  quantity?: number | undefined;
  /** troca de solo: quantidades de origem e de destino (padrão: `quantity` nas duas) [P] */
  source?: number | undefined;
  destination?: number | undefined;
}

/**
 * `Location(roadLine, início, centro, fim, distância)@009ba990` [O]: road line nula → logic_error; início = fim → 46;
 * início > fim → 8; centro > fim → 9; centro < início → 10; início < mínimo da road line → 11; fim > máximo → 12;
 * distância < 0 → 60. Padrão (`GetDefaultLocation@0090e810`): a road line inteira, centro no meio, distância 0 [O].
 */
function makeLocation(p: Project, rl: Entity, w: WorkPlaceSpec): Entity {
  if (!isLocation(rl)) throw new Error("a task location is a road line or an area");
  const s = stationSpan(rl);
  const b = w.begin ?? s.min, e = w.end ?? s.max;
  const c = w.center ?? (b + e) * 0.5;
  const d = w.distance ?? 0;
  if (b === e) fail("ZERO_LENGTH_LOCATION");
  if (b > e) fail("BEGIN_STATION_GREATER_THAN_END_STATION");
  if (c > e) fail("CENTER_STATION_GREATER_THAN_END_STATION");
  if (c < b) fail("CENTER_STATION_SMALLER_THAN_BEGIN_STATION");
  if (b < s.min) fail("BEGIN_STATION_SMALLER_THAN_LOCATION_BEGIN_STATION", `"${rl.name}" starts at ${s.min}`);
  if (e > s.max) fail("END_STATION_GREATER_THAN_LOCATION_END_STATION", `"${rl.name}" ends at ${s.max}`);
  if (d < 0) fail("DISTANCE_CANNOT_BE_NEGATIVE");
  return p.create("Location", [...kernel(), dbl(203, d), ref(205, rl.oid), dbl(206, b), dbl(207, c), dbl(208, e)]);
}

/** Quantidades do work place na unidade do tipo da tarefa (SetDefaults: 0 na criação) [O]; negativa → NEGATIVE_AMOUNT (16) [I onde]. */
function amountsOf(cls: string, w: WorkPlaceSpec): { source: number; destination: number; amount: number } {
  const q = w.quantity ?? 0;
  const source = cls === "MassExchange" ? w.source ?? q : SOURCE_AMOUNT.has(cls) ? q : 0;
  const destination = cls === "MassExchange" ? w.destination ?? q : DEST_AMOUNT.has(cls) ? q : 0;
  const amount = cls === "OtherWorkSite" ? q : 0;
  for (const v of [source, destination, amount]) if (!(v >= 0)) fail("NEGATIVE_AMOUNT");
  return { source, destination, amount };
}

/**
 * `WorkPlace(site, local, horas)@009344b0` / `MovableWorkPlace(site, local, horas, origem, destino)@009605a0` [O]:
 * início = fim = MinDate + horas × 3600 (horas 0); m_bLockedAsActual false. As datas reais vêm do recálculo
 * (`ScheduleManager::ResetTimings`, U-07) [I, C-07].
 */
function makeWorkPlace(p: Project, t: Entity, loc: Entity, w: WorkPlaceSpec): Entity {
  const a = amountsOf(t.className, w);
  const common = [...kernel(), ref(200, loc.oid), ref(201, t.oid), i64(209, BigInt(MIN_DATE)), i64(210, BigInt(MIN_DATE)), bool(211, false)];
  return t.className === "OtherWorkSite"
    ? p.create("OtherWorkPlace", [...common, dbl(300, a.amount)])
    : p.create("MovableWorkPlace", [...common, dbl(306, a.source), dbl(307, a.destination)]);
}

/**
 * `WorkSite::AddWorkPlace@0093ea20` [O]: classe que não aceita vários → "unable to contain multiple work places";
 * work places da mesma tarefa que se cruzam → WORK_PLACES_CANNOT_INTERSECT (47); lista ordenada (`WorkPlaceCompare`:
 * road line e estaca inicial [I]). Encostar não é cruzar (StationSpanHelpers::IsIntersecting) [I].
 */
function attachWorkPlace(p: Project, t: Entity, wp: Entity): void {
  const list = workPlacesOf(p, t);
  if (list.length && !MULTI_WORK_PLACES.has(t.className)) fail("MULTIPLE_WORK_PLACES", `a ${t.className} has a single location`);
  const span = (w: Entity) => {
    const l = locationOf(p, w)!;
    return { rl: asRef(l.get("m_pRoadLine")), b: num(l.get("m_dStationBegin")) ?? 0, e: num(l.get("m_dStationEnd")) ?? 0 };
  };
  const n = span(wp);
  for (const o of list) {
    const x = span(o);
    if (x.rl === n.rl && n.b < x.e && x.b < n.e) fail("WORK_PLACES_CANNOT_INTERSECT");
  }
  const sorted = [...list, wp].sort((a, b) => {
    const sa = span(a), sb = span(b);
    return sa.rl === sb.rl ? sa.b - sb.b : Number((sa.rl ?? 0n) - (sb.rl ?? 0n));
  });
  t.setRaw("m_vpWorkPlaces", encodeContainer(FT.POINTER64, sorted.map((w) => w.oid)));
}

export interface TaskSpec {
  kind: TaskKind;
  /** tipo de origem (corte, jazida, troca de solo), de destino (aterro, bota-fora, pilha, britagem) ou de tarefa (Task) */
  type?: Entity | undefined;
  /** troca de solo: tipo de destino */
  destType?: Entity | undefined;
  sumTask?: Entity | undefined;
  roadLine?: Entity | undefined;
  name?: string | undefined;
  longName?: string | undefined;
  comment?: string | undefined;
  workPlaces?: readonly WorkPlaceSpec[] | undefined;
}

/**
 * Tarefa nova: `CreateTaskCommand@00487690` → `ProjectHelpers::AddWorkSite@0090d300` → `Project::Add<Classe>`
 * (`Project_AddLandCut@0090b830` e irmãs, §3.2) [O]:
 * 1. sum task = a informada; senão a da tarefa mais nova (maior OID); senão a raiz;
 * 2. tipo = o informado (exige a adequação da classe → "Invalid suitability"); senão o padrão (§3.5);
 * 3. road line = a do 1º work place / a informada; senão a da tarefa mais nova; senão a principal;
 * 4. `Location` padrão = road line inteira; os work places informados fazem o papel do diálogo `EditWorkSiteDlg`;
 * 5. construtor (§3.3): prioridade 500, autoName, coeficiente 1.0, calendário padrão, layout copiado do tipo…;
 * 6. `SetWorkSiteDefaults@00913930`: datas forçadas = início/prazo do projeto (sem restrição), AutoName;
 *    jazida/bota-fora/pilha/britagem também `SetBeginTime(início)`/`SetEndTime(prazo)` (`SetDefaults@00913000`);
 * 7. equipes (`SelectSuitableWorkGroups`) [I]; dependências automáticas e datas recalculadas no mesmo nível [I].
 * Nome informado → m_bAutoName false, como quando o usuário digita um nome [O §3.6].
 */
export function addTask(p: Project, spec: TaskSpec): Entity {
  const cls: TaskClass = TASK_KINDS[spec.kind];
  if (!cls) throw new Error(`unknown task kind: ${String(spec.kind)}`);
  const rule = TYPE_RULES[cls];
  // 1. sum task
  const newest = newestTask(p);
  const sumTask = spec.sumTask ?? p.resolve(asRef(newest?.get("m_pSumTaskParent"))) ?? rootSumTask(p);
  if (sumTask.className !== "SumTask") throw new Error("sumTask must be a sum task");
  // 2. tipos
  let source: Entity | undefined, dest: Entity | undefined, work: Entity | undefined;
  const check = (t: Entity, cls2: string, st?: number) => {
    if (t.className !== cls2 || (st !== undefined && num(t.get("m_nSuitabilityType")) !== st)) {
      fail("INVALID_SUITABILITY", `${cls} needs a ${cls2}${st !== undefined ? ` with suitability ${st}` : ""}; "${t.name}" is a ${t.className}${t.has("m_nSuitabilityType") ? ` with suitability ${num(t.get("m_nSuitabilityType"))}` : ""}`);
    }
  };
  if (rule.work) {
    work = spec.type ?? defaultWorkType(p);
    check(work, "WorkType");
  } else {
    if (rule.source !== undefined) {
      source = spec.type ?? defaultSourceType(p, rule.source);
      check(source, "SourceLandType", rule.source);
    }
    if (rule.dest !== undefined) {
      dest = (rule.source !== undefined ? spec.destType : spec.type) ?? defaultDestType(p, rule.dest);
      check(dest, "DestLandType", rule.dest);
    }
  }
  const mainType = (work ?? source ?? dest)!;
  // 3. road line
  const wps = spec.workPlaces?.length ? spec.workPlaces : [{}];
  const roadLine = wps[0]!.location ?? spec.roadLine ?? (newest ? roadLineOfTask(p, newest) : undefined) ?? mainRoadLine(p);
  // 5. construtor
  const root = projectRoot(p);
  const r = (m: string) => asRef(root.get(m));
  const cal = defaultCalendar(p);
  const wsLook = p.create("WorkSiteLook", [...kernel(), fld(200, mapValue(FT.SINT, FT.SINT, [[0, 1], [1, 0], [2, 1], [3, 1], [4, 0]].map(([k, v]) => [fvInt(k!), fvInt(v!)] as [FieldValue, FieldValue])))]);
  // ^ [I] valores do WorkSiteLook: os de 96% dos exemplos (o construtor não foi lido, C-03)
  const fields: Field[] = [
    ...kernel(spec.name ?? "", spec.longName ?? ""), refList(200, []), refList(201, []), ref(202, copyLayout(p, mainType).oid),
    ref(205, cal?.oid ?? null), ref(206, r("m_pDependencyManager")), ref(210, r("m_pWorkGroupPicker")), u32(211, 500), str(213, spec.comment ?? ""),
    emptyMap(214), bool(215, true), ref(216, wsLook.oid), ref(217, null), bool(218, false),
    i64(219, projectBegin(p)), i32(220, 0), i64(221, projectDeadline(p)), i32(222, 0), bool(223, true), bool(224, true),
    ref(225, r("m_pScheduleManager")), bool(226, false), i32(227, 0), emptyMap(228), bool(229, true), ref(231, r("m_pImplManager")), dbl(318, 1.0),
  ];
  if (cls === "OtherWorkSite") fields.push(ref(301, work!.oid));
  else {
    fields.push(ref(303, r("m_pMoveManager")), dbl(315, 0), dbl(316, 0));
    switch (cls) {
      case "LandCut": fields.push(ref(402, source!.oid), i32(407, 5), bool(416, false)); break;
      case "Embankment": fields.push(ref(400, dest!.oid), bool(402, false), i32(403, 5)); break;
      case "MassExchange": fields.push(ref(400, dest!.oid), ref(401, source!.oid)); break;
      case "BorrowPit": fields.push(bool(401, false), ref(402, source!.oid), bool(404, false)); break;
      case "WasteLand": fields.push(ref(401, dest!.oid), bool(402, false)); break;
      case "CrushingPlant": fields.push(ref(402, dest!.oid), bool(404, true), i32(405, 0)); break;
      case "StockPile": fields.push(ref(400, dest!.oid)); break;
    }
  }
  const t = p.create(cls, fields);
  // 4. work places (o primeiro é o do construtor; os demais, AddWorkPlace)
  for (const w of wps) {
    const loc = makeLocation(p, w.location ?? roadLine, w);
    attachWorkPlace(p, t, makeWorkPlace(p, t, loc, w));
  }
  // contêineres do projeto e da sum task (WorkSiteContainer::Add<Classe>, SetSumTaskParent) [O]
  appendRef(need(rootRef(p, "m_pWSContainer"), "WorkSiteContainer"), CONTAINER_LIST[cls], t.oid);
  setTaskSumTask(p, t, sumTask);
  // 6. nome
  if (spec.name) t.set("m_bAutoName", false);
  else autoName(p, t);
  // 7. equipes e datas
  selectSuitableWorkGroups(p, t);
  afterTaskChange(p, WHOLE_PROJECT.has(cls) ? [t] : []);
  return t;
}

/** `WorkSiteCommands::AddWorkPlaceCommand@0053b0a0` ("New task location", 14755): um work place a mais na tarefa [O]. */
export function addTaskLocation(p: Project, t: Entity, w: WorkPlaceSpec): Entity {
  if (!isTask(t)) throw new Error("not a task");
  const rl = w.location ?? roadLineOfTask(p, t) ?? mainRoadLine(p);
  const wp = makeWorkPlace(p, t, makeLocation(p, rl, w), w);
  attachWorkPlace(p, t, wp);
  afterTaskChange(p, WHOLE_PROJECT.has(t.className) ? [t] : []);
  return wp;
}

/**
 * Fecho do `TimingCalculationPostponer` das tarefas [I]: dependências automáticas (`UpdateAutoDependencies`) e datas
 * (`ScheduleManager::ResetTimings`, reconstruído em U-07); as tarefas não contínuas novas recebem SetBeginTime/SetEndTime.
 * Se o cronograma não fecha (equipe sem taxa…), as datas ficam como estão e o erro não desfaz a criação [P]: o usuário
 * vê a violação no check_project / Gantt, como no original quando o cálculo de datas não converge [D].
 */
export function afterTaskChange(p: Project, wholeProject: readonly Entity[] = []): string | undefined {
  try {
    applyAutoDependencies(p);
    for (const t of wholeProject) {
      setBeginTime(p, t, Number(projectBegin(p)));
      setEndTime(p, t, Number(projectDeadline(p)));
    }
    resetTimings(p);
    warnings.delete(p);
    return undefined;
  } catch (e) {
    if (e instanceof CreateError) throw e;
    if (strictDepth > 0) throw new Error(`${ACTION_CANNOT_BE_COMPLETED}\n\n${(e as Error).message}`);
    const msg = `schedule not recalculated: ${(e as Error).message}`;
    warnings.set(p, msg);
    return msg;
  }
}
const warnings = new WeakMap<Project, string>();

/** "The action cannot be completed." (14722): título do aviso do `Controller::Invoke` para `Exception` [O]. */
export const ACTION_CANNOT_BE_COMPLETED = "The action cannot be completed.";
let strictDepth = 0;
/**
 * U-31: ações da interface (diálogos, menus, Insert, planilhas, visões) — erro no cálculo de datas desfaz o comando
 * inteiro e vira mensagem, como `Controller::Invoke` (`catch` → `Transaction::Cancel`) [O `dialogos_infra.md` §6]. Fora
 * dele (MCP, montagem da obra), a edição fica com aviso em `takeTimingWarning` [P].
 */
export function strictTiming<T>(fn: () => T): T {
  strictDepth++;
  try {
    return fn();
  } finally {
    strictDepth--;
  }
}
export const isStrictTiming = (): boolean => strictDepth > 0;
/** Guarda (texto) ou limpa (undefined) o aviso do recálculo de datas; U-29: também o postponer (`core/postponer.ts`). */
export function noteTimingWarning(p: Project, msg: string | undefined): void {
  if (msg) warnings.set(p, msg);
  else warnings.delete(p);
}
/** Aviso do último recálculo de datas que não fechou (e o limpa). */
export function takeTimingWarning(p: Project): string | undefined {
  const w = warnings.get(p);
  warnings.delete(p);
  return w;
}

// =====================================================================================================================
// Dependência (§6)
// =====================================================================================================================

export const DEPENDENCY_TYPES = { finish_finish: DEP.FINISH_FINISH, start_finish: DEP.START_FINISH, finish_start: DEP.FINISH_START, start_start: DEP.START_START, by_stations: DEP.BY_STATIONS } as const;

/**
 * `AddDependencyCommand(project, pred, succ, tipo, args)@0050fa60` → `Helpers::AddDependency@0050e4c0` →
 * `DependencyManager::AddDependency(…, userGenerated = true)@009a3260` [O]. Argumentos padrão = `DependencyDlg::m_lastArgs`
 * (estático @0x285504c): mínimo 0 dias corridos, sem máximo, cor 0x000000FF (vermelho), largura 1, visível nas três
 * visões [O]. Validações: BY_STATIONS sem interseção → 18; mínimo > máximo → 26; ciclo → 56 [O].
 */
export function addDependency(p: Project, pred: Entity, succ: Entity, type: number, args: Partial<DependencyArgs> = {}): Entity {
  if (!isTask(pred) || !isTask(succ)) throw new Error("dependencies link two tasks");
  const a: DependencyArgs = { ...DEFAULT_DEPENDENCY_ARGS, color: 0x000000ff, ...args };
  if (type === DEP.BY_STATIONS && !intersect(p, pred, succ)) fail("WORK_SITES_DONT_INTERSECT");
  if (a.hasMaxDelay && a.hasMinDelay && a.minDelay > a.maxDelay) fail("MIN_DELAY_GREATER_THAN_MAX_DELAY");
  try {
    return addUserDependency(p, pred, succ, type, a);
  } catch (e) {
    if (e instanceof TimingEditError && e.code !== "BEGIN_TIME_GREATER_THAN_END_TIME") fail("CIRCULAR_DEPENDENCY");
    throw e;
  }
}

// =====================================================================================================================
// Propriedades do projeto (§2)
// =====================================================================================================================

export interface ProjectProperties {
  name?: string | undefined;
  longName?: string | undefined;
  client?: string | undefined;
  planner?: string | undefined;
  begin?: bigint | undefined;
  deadline?: bigint | undefined;
  currency?: string | undefined;
  lengthUnit?: string | undefined;
  mainRoadLine?: { begin: number; end: number } | undefined;
  defaultCalendar?: Entity | undefined;
  /** renomear as unidades de massa: o original não troca as referências (não há SetCutUnit), troca-se o nome da Unit [O] */
  unitNames?: { [K in "cut" | "fill" | "crush" | "haul"]?: string | undefined } | undefined;
}

/**
 * `ProjectSettingsDlg::OnOK@00625950`: um `CompositeCommand` com SetTimeSpan (`Project::SetTimeSpan@009136b0`: datas ao
 * início do dia; menos de 1 dia → BEGIN_TIME_GREATER_THAN_END_TIME), SetCreator ("planner"), SetName, SetLongName,
 * SetOrderer ("client"), RoadLineCommands::SetStationSpan, SetCurrencySign, SetLengthUnit e SetDefaultCalendar [O].
 */
export function setProjectProperties(p: Project, o: ProjectProperties): void {
  const root = projectRoot(p);
  if (o.begin !== undefined || o.deadline !== undefined) {
    const day = (t: bigint) => (t / 86400n) * 86400n - (t % 86400n < 0n ? 86400n : 0n);
    const b = day(o.begin ?? projectBegin(p)), e = day(o.deadline ?? projectDeadline(p));
    if (Number(e - b) / 86400 < 1) fail("BEGIN_TIME_GREATER_THAN_END_TIME");
    if (b !== projectBegin(p) || e !== projectDeadline(p)) {
      try {
        setProjectWindow(p, Number(b), Number(e)); // UpdateProjectTimingDependentWorkSitesTiming (engine/window.ts)
      } catch (err) {
        if (err instanceof TimeSpanError) fail("BEGIN_TIME_GREATER_THAN_END_TIME", "a milestone, usage break or intersection does not fit the new project window");
        throw err;
      }
    }
  }
  if (o.planner !== undefined) root.set("m_strCreator", o.planner);
  if (o.name !== undefined) root.set("m_strName", o.name);
  if (o.longName !== undefined) root.set("m_strLongName", o.longName);
  if (o.client !== undefined) root.set("m_strOrderer", o.client);
  if (o.mainRoadLine) setStationSpan(p, mainRoadLine(p), o.mainRoadLine.begin, o.mainRoadLine.end);
  if (o.currency !== undefined) root.set("m_strCurrencySign", o.currency);
  if (o.lengthUnit !== undefined) root.set("m_strLengthUnit", o.lengthUnit);
  if (o.defaultCalendar) setDefaultCalendar(p, o.defaultCalendar);
  if (o.unitNames) {
    const mu = massUnits(p);
    for (const k of ["cut", "fill", "crush", "haul"] as const) {
      const n = o.unitNames[k];
      if (n === undefined) continue;
      if (!n.trim()) fail("NAME_CANNOT_BE_EMPTY");
      mu[k].set("m_strName", n);
    }
  }
}

/**
 * `RoadLine::SetStationSpan@008fd1d0` [O]: início > fim → 8; início = fim → 45; tarefas, interseções ou usage breaks
 * que ficariam fora → 19 / 20 / 21 [O códigos, I a ordem das checagens].
 */
export function setStationSpan(p: Project, rl: Entity, begin: number, end: number, remap = false): void {
  if (rl.className !== "RoadLine") throw new Error("only road lines have stations");
  if (!Number.isInteger(begin) || !Number.isInteger(end)) throw new Error("road line stations are integers");
  // U-37 (`eixos_areas_locais.md` §7.2) [O]: iguais → nada; 8; 45; coordenadas fora sem reescala → 53
  if (begin === num(rl.get("m_nStationBegin")) && end === num(rl.get("m_nStationEnd"))) return;
  if (begin > end) fail("BEGIN_STATION_GREATER_THAN_END_STATION");
  if (begin === end) fail("ZERO_LENGTH_ROADLINE");
  const coords = roadLineCoordinates(rl);
  if (coords.length && !remap && (coords[0]!.s < begin || coords.at(-1)!.s > end)) fail("COORDINATES_OUTSIDE_STATION_SPAN");
  for (const l of p.byClass("Location")) {
    if (l.get("m_pRoadLine") !== rl.oid) continue;
    if ((num(l.get("m_dStationBegin")) ?? 0) < begin || (num(l.get("m_dStationEnd")) ?? 0) > end) fail("WORK_SITE_IS_OUT_OF_STATION_SPAN_RANGE");
  }
  for (const pl of p.byClass("Place")) {
    if (pl.get("m_pRoadLine") !== rl.oid) continue;
    const s = num(pl.get("m_dStation")) ?? 0;
    if (s < begin || s > end) fail("ROAD_CONNECTION_IS_OUT_OF_STATION_SPAN_RANGE");
  }
  for (const u of refs(rl.get("m_usageBreaks")).map((o) => p.get(o)).filter((e): e is Entity => !!e)) {
    if ((num(u.get("m_nStationBegin")) ?? 0) < begin || (num(u.get("m_nStationEnd")) ?? 0) > end) fail("USAGE_BREAK_IS_OUT_OF_STATION_SPAN_RANGE");
  }
  rl.set("m_nStationBegin", begin);
  rl.set("m_nStationEnd", end);
  if (coords.length && remap) setCoordinateSpan(p, rl, begin, end);
}

// =====================================================================================================================
// U-37: road line, área e local (`eixos_areas_locais.md`)
// =====================================================================================================================

/** Entrada de `RoadLine::m_coordinates` (f317: estaca → (X, Y, largura esquerda, direita)). */
export interface StationCoord { s: number; x: number; y: number; wl: number; wr: number }
/** `m_coordinates` em ordem de estaca. */
export function roadLineCoordinates(rl: Entity): StationCoord[] {
  const out: StationCoord[] = [];
  for (const [k, v] of mapEntries(rl, "m_coordinates")) {
    if (k.kind !== "float" || v.kind !== "tuple") continue;
    const [x, y, wl, wr] = v.items.map((i) => (i.kind === "float" ? i.value : 0));
    out.push({ s: k.value, x: x ?? 0, y: y ?? 0, wl: wl ?? 0, wr: wr ?? 0 });
  }
  return out.sort((a, b) => a.s - b.s);
}
function writeCoordinates(rl: Entity, cs: readonly StationCoord[]): void {
  rl.setRaw("m_coordinates", mapValue(FT.DOUBLE, FT.TUPLE, cs.map((c) => [fvDbl(c.s), fvTuple(fvDbl(c.x), fvDbl(c.y), fvDbl(c.wl), fvDbl(c.wr))] as [FieldValue, FieldValue])));
}
/** `RoadLineGeometry::GetCoordinate/GetWidths` [O]: interpolação linear no segmento; fora das pontas, o 1.º/último [I]. */
export function coordinateAt(cs: readonly StationCoord[], s: number): StationCoord {
  if (cs.length === 0) return { s, x: 0, y: 0, wl: 0, wr: 0 };
  if (cs.length === 1) return { ...cs[0]!, s };
  let i = cs.findIndex((c) => c.s >= s);
  if (i <= 0) i = i === 0 ? 1 : cs.length - 1;
  const a = cs[i - 1]!, b = cs[i]!;
  const t = b.s === a.s ? 0 : (s - a.s) / (b.s - a.s);
  const l = (u: number, v: number) => u + (v - u) * t;
  return { s, x: l(a.x, b.x), y: l(a.y, b.y), wl: l(a.wl, b.wl), wr: l(a.wr, b.wr) };
}
/** `RoadLine::HasCoordinates@0x8fc680` = ≥ 2 coordenadas; área: ≥ 1 polígono [O]. */
export function locationHasCoordinates(p: Project, loc: Entity): boolean {
  return loc.className === "RoadLine" ? roadLineCoordinates(loc).length >= 2 : areaPolygons(p, loc).length >= 1;
}
/** `anon::Is180DegreeTurn@0x8fc6a0` [O]: soma dos vetores unitários ≈ 0 [I tolerância]. */
function is180(a: StationCoord, b: StationCoord, c: StationCoord): boolean {
  const u = [b.x - a.x, b.y - a.y], v = [c.x - b.x, c.y - b.y];
  const lu = Math.hypot(u[0]!, u[1]!), lv = Math.hypot(v[0]!, v[1]!);
  if (lu === 0 || lv === 0) return false;
  return Math.hypot(u[0]! / lu + v[0]! / lv, u[1]! / lu + v[1]! / lv) < 1e-9;
}
/**
 * `RoadLine::ValidateCoordinates@0x8fd6c0` [O]: descarta em silêncio o ponto igual ao anterior mantido e a meia-volta de
 * 180°; havendo coordenadas, estende a road line até cobri-las (`SetStationSpan(…, remap = false)`); nunca encolhe.
 */
function validateCoordinates(p: Project, rl: Entity): void {
  const kept: StationCoord[] = [];
  for (const c of roadLineCoordinates(rl)) {
    const prev = kept.at(-1);
    if (prev && (prev.s === c.s || (prev.x === c.x && prev.y === c.y))) continue;
    if (kept.length >= 2 && is180(kept.at(-2)!, prev!, c)) continue;
    kept.push(c);
  }
  writeCoordinates(rl, kept);
  if (!kept.length) return;
  const b = Math.min(num(rl.get("m_nStationBegin")) ?? 0, Math.floor(kept[0]!.s)), e = Math.max(num(rl.get("m_nStationEnd")) ?? 0, Math.ceil(kept.at(-1)!.s));
  setStationSpan(p, rl, b, e, false);
}
/** `RoadLine::SetCoordinateSpan(a, b)@0x8fcbe0` [O]: reescala linear das estacas das coordenadas para [a, b]. */
function setCoordinateSpan(p: Project, rl: Entity, a: number, b: number): void {
  const cs = roadLineCoordinates(rl);
  if (cs.length < 2) return;
  const f = cs[0]!.s, l = cs.at(-1)!.s;
  writeCoordinates(rl, cs.map((c) => ({ ...c, s: Math.min(b, Math.max(a, ((c.s - f) * (b - a)) / (l - f) + a)) })));
  validateCoordinates(p, rl);
}
/**
 * `RoadLineBasicInfoTab::ShouldCoordinatesBeRemapped@0x655310` [O]: ≥ 2 coordenadas, estacas mudaram e as coordenadas
 * cobrem a road line com folga ≤ 1 em cada ponta.
 */
export function shouldRemapCoordinates(rl: Entity, begin: number, end: number): boolean {
  const cs = roadLineCoordinates(rl);
  if (cs.length < 2) return false;
  const b0 = num(rl.get("m_nStationBegin")) ?? 0, e0 = num(rl.get("m_nStationEnd")) ?? 0;
  if (begin === b0 && end === e0) return false;
  return Math.abs(cs[0]!.s - b0) <= 1 && Math.abs(cs.at(-1)!.s - e0) <= 1;
}
/** `RoadLine::GetStationWidths` [O]: dinâmica → interpolada; fixa → largura/2 por lado, ou 10 se ≤ 0. */
function stationWidths(rl: Entity, s: number): [number, number] {
  if (rl.get("m_bDynamicWidth") === true) { const c = coordinateAt(roadLineCoordinates(rl), s); return [c.wl, c.wr]; }
  const h = (num(rl.get("m_dWidth")) ?? 0) / 2;
  return h > 0 ? [h, h] : [10, 10];
}
/** `RoadLine::AddStationCoordinate@0x8fc320` [O]: larguras ≤ 0 → `GetStationWidths`; mesma estaca sobrescreve; valida. */
export function addStationCoordinate(p: Project, rl: Entity, c: StationCoord): void {
  const [dl, dr] = stationWidths(rl, c.s);
  const next = roadLineCoordinates(rl).filter((x) => x.s !== c.s);
  next.push({ s: c.s, x: c.x, y: c.y, wl: c.wl > 0 ? c.wl : dl, wr: c.wr > 0 ? c.wr : dr });
  writeCoordinates(rl, next.sort((a, b) => a.s - b.s));
  validateCoordinates(p, rl);
}
/** `RoadLine::RemoveStationCoordinate@0x8fcae0` [O]. */
export function removeStationCoordinate(p: Project, rl: Entity, s: number): void {
  writeCoordinates(rl, roadLineCoordinates(rl).filter((x) => x.s !== s));
  validateCoordinates(p, rl);
}
/** `RoadLineCoordinatesTab::GetNextStation@0x65a7a0` [O]. */
export function nextCoordinateStation(rl: Entity): number {
  const cs = roadLineCoordinates(rl), end = num(rl.get("m_nStationEnd")) ?? 0;
  if (!cs.length) return num(rl.get("m_nStationBegin")) ?? 0;
  if (cs.length === 1) return Math.min(cs[0]!.s + 20, end);
  return Math.min(cs.at(-1)!.s + (cs.at(-1)!.s - cs.at(-2)!.s), end);
}
/** `SetDynamicWidth@0x8fd0d0` [O]: ligar com largura ≠ 0 escreve largura/2 dos dois lados em todas as coordenadas. */
export function setDynamicWidth(rl: Entity, on: boolean): void {
  if ((rl.get("m_bDynamicWidth") === true) === on) return;
  const w = num(rl.get("m_dWidth")) ?? 0;
  if (on && w !== 0) writeCoordinates(rl, roadLineCoordinates(rl).map((c) => ({ ...c, wl: w / 2, wr: w / 2 })));
  rl.set("m_bDynamicWidth", on);
}
/** `SetWidth@0x8fd670` (sem validação) e `SetDirectionality@0x8fd0a0` [O]. */
export function setRoadLineWidth(rl: Entity, w: number): void { if (num(rl.get("m_dWidth")) !== w) rl.set("m_dWidth", w); }
export function setDirectionality(rl: Entity, d: number): void { if (num(rl.get("m_nDirectionality")) !== d) rl.set("m_nDirectionality", d); }

/** `RoadLineUISettings` do local (cria se faltar [I]). */
function settingsOf(p: Project, loc: Entity): Entity {
  const s = p.resolve(asRef(loc.get("m_pUISettings")));
  if (s) return s;
  const n = newLineSettings(p);
  loc.set("m_pUISettings", n.oid);
  return n;
}
/** `RoadLineUISettings::DEFAULT_COLORS@0x456870` em COLORREF [O]. */
const LINE_DEFAULT_COLORS = [0x646464, 0xff0000, 0x808080, 0x00ff00, 0x00ffff, 0x0000ff, 0xffffff];
/** `GetColor(tipo)@0x9bbc60` [O]: `m_mColors[tipo]`, senão o padrão. */
export function locationColor(p: Project, loc: Entity, type: number): number {
  const s = p.resolve(asRef(loc.get("m_pUISettings")));
  const hit = s ? mapEntries(s, "m_mColors").find(([k]) => keyOid(k) === BigInt(type))?.[1] : undefined;
  return hit && hit.kind === "int" ? hit.value : LINE_DEFAULT_COLORS[type] ?? 0;
}
/** `SetColor(tipo, cor)@0x9bbf20` (não compara) [O]. */
export function setLocationColor(p: Project, loc: Entity, type: number, color: number): void {
  const s = settingsOf(p, loc);
  const entries = mapEntries(s, "m_mColors").filter(([k]) => keyOid(k) !== BigInt(type));
  entries.push([fvInt(type), encode(FT.ULONG, color >>> 0)]);
  entries.sort((a, b) => Number(keyOid(a[0]) ?? 0n) - Number(keyOid(b[0]) ?? 0n));
  s.setRaw("m_mColors", mapValue(FT.SINT, FT.ULONG, entries));
}
const hiddenColorTypes = (s: Entity): number[] => {
  const v = s.get("m_sNonVisibleMapViewColors");
  return Array.isArray(v) ? (v as ModelValue[]).map((x) => num(x)).filter((x): x is number => x !== null) : [];
};
/** `IsVisibleInMapView(tipo)@0x9bbd20` = tipo ausente de `m_sNonVisibleMapViewColors` [O]. */
export function colorVisibleInMap(p: Project, loc: Entity, type: number): boolean {
  const s = p.resolve(asRef(loc.get("m_pUISettings")));
  return !s || !hiddenColorTypes(s).includes(type);
}
/** `SetVisibleInMapView(tipo, bool)@0x9bbf80` [O]: desmarcado insere o tipo no conjunto; marcado remove. */
export function setColorVisibleInMap(p: Project, loc: Entity, type: number, visible: boolean): void {
  if (colorVisibleInMap(p, loc, type) === visible) return;
  const s = settingsOf(p, loc);
  const cur = hiddenColorTypes(s).filter((x) => x !== type);
  if (!visible) cur.push(type);
  s.setRaw("m_sNonVisibleMapViewColors", encodeContainer(FT.ULONG, cur.sort((a, b) => a - b)));
}
/** `m_dAlpha` (padrão 0,7) e `SetAlpha@0x9bbe90` [O]. */
export const locationAlpha = (p: Project, loc: Entity): number => num(p.resolve(asRef(loc.get("m_pUISettings")))?.get("m_dAlpha")) ?? 0.7;
export function setLocationAlpha(p: Project, loc: Entity, a: number): void {
  const s = settingsOf(p, loc);
  if (num(s.get("m_dAlpha")) !== a) s.set("m_dAlpha", a);
}
/** `AreaHelpers::IsParent(a, b)@0x9ed020` [O]: a = b ou a é ancestral de b pela cadeia `m_pAreaParent`. */
export function isAreaParent(p: Project, a: Entity, b: Entity): boolean {
  return areaAncestors(p, b).includes(a.oid);
}
/**
 * `RoadLine::SetAreaParent@0x8fcb90` / `Area::SetAreaParent@0x92d180` [O]: troca o pai e as listas de filhos; área nova
 * que é o próprio local ou descendente dele → 40 (14723).
 */
export function setLocationParent(p: Project, loc: Entity, parent: Entity | null): void {
  const old = p.resolve(asRef(loc.get("m_pAreaParent")));
  if ((old?.oid ?? null) === (parent?.oid ?? null)) return;
  if (loc.className === "Area" && parent && isAreaParent(p, loc, parent)) fail("WANTED_AREA_PARENT_IS_CHILD");
  const list = loc.className === "Area" ? "m_sAreaChildren" : "m_sRoadLineChildren";
  if (old) removeRef(old, list, loc.oid);
  loc.set("m_pAreaParent", parent?.oid ?? null);
  if (parent) appendRef(parent, list, loc.oid);
}

/** Polígonos da área (`Area::m_shapes`, ordem de inclusão) e pontos (`PolygonShape::m_vPoints`, pares X → Y). */
export function areaPolygons(p: Project, area: Entity): Entity[] {
  return refs(area.get("m_shapes")).map((o) => p.get(o)).filter((e): e is Entity => e?.className === "PolygonShape");
}
export function polygonPointList(shape: Entity): { x: number; y: number }[] {
  return mapEntries(shape, "m_vPoints").map(([k, v]) => ({ x: k.kind === "float" ? k.value : 0, y: v.kind === "float" ? v.value : 0 }));
}
/** `PolygonShape::SetPoints@0x92afb0` [O]: ≥ 3 pontos, senão 51. */
export function setPolygonPointList(shape: Entity, pts: readonly { x: number; y: number }[]): void {
  if (pts.length < 3) fail("INVALID_POLYGON");
  shape.setRaw("m_vPoints", mapValue(FT.DOUBLE, FT.DOUBLE, pts.map((q) => [fvDbl(q.x), fvDbl(q.y)] as [FieldValue, FieldValue])));
}
/** `UIManager::AddPolygon@0x96ff80` [O]: polígono da área em `m_vPolygons`, em `Area::m_shapes` e na ordem de desenho. */
export function addAreaPolygon(p: Project, area: Entity, pts: readonly { x: number; y: number }[]): Entity {
  if (pts.length < 3) fail("INVALID_POLYGON");
  const shape = p.create("PolygonShape", [...kernel(), ref(200, area.oid), fld(300, mapValue(0, 0, []))]);
  setPolygonPointList(shape, pts);
  appendRef(need(ui(p), "UIManager"), "m_vPolygons", shape.oid);
  appendRef(area, "m_shapes", shape.oid);
  orderHelperAdd(p, shape.oid);
  return shape;
}
/** `UIManager::RemovePolygon@0x9704e0` [O]. */
export function removeAreaPolygon(p: Project, shape: Entity): void {
  const u = ui(p);
  if (u) removeRef(u, "m_vPolygons", shape.oid);
  const area = p.resolve(asRef(shape.get("m_pArea")));
  if (area) removeRef(area, "m_shapes", shape.oid);
  orderHelperRemove(p, new Set([shape.oid]));
  p.remove(shape);
}

/**
 * Leitor VGP do Xroad (`VGPImporterHelpers::ImportStationCoordinatesFromFile@0x880a90`) [O]: `TIE <nome>` abre uma road
 * line; `ELEMP1|ELEMP2 t1 t2 t3 t4` = estaca t2, X t4, Y t3 (o 1.º elemento depois do TIE aceita os dois; os seguintes
 * só ELEMP2); números com ponto decimal; o resto é ignorado.
 */
export function parseVgp(text: string): Map<string, { s: number; x: number; y: number }[]> {
  const out = new Map<string, { s: number; x: number; y: number }[]>();
  let cur: { s: number; x: number; y: number }[] | null = null;
  for (const line of text.split(/\r?\n/)) {
    const tie = /^TIE\s+(\S+).*$/.exec(line);
    if (tie) { cur = []; out.set(tie[1]!, cur); continue; }
    const el = /^(ELEMP[12])\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+).*$/.exec(line);
    if (!el || !cur || (cur.length > 0 && el[1] !== "ELEMP2")) continue;
    const [s, y, x] = [Number(el[3]), Number(el[4]), Number(el[5])];
    if ([s, x, y].every(Number.isFinite)) cur.push({ s, x, y });
  }
  return out;
}
/** Import... da 13055 (`OnImportPressed@0x65b130`) [O]: só com exatamente 1 road line no arquivo; larguras 10 e 10. */
export function importVgpCoordinates(p: Project, rl: Entity, text: string): number {
  const lines = parseVgp(text);
  if (lines.size !== 1) return 0;
  const pts = [...lines.values()][0]!;
  for (const q of pts) addStationCoordinate(p, rl, { s: q.s, x: q.x, y: q.y, wl: 10, wr: 10 });
  return pts.length;
}

// =====================================================================================================================
// Remoção (§11)
// =====================================================================================================================

/** Classes que o visitor `Remover@00908b70` aceita (variant de 20 tipos de `ProjectHelpers::Remove@00910c70`) [O] + Image e TypeDependency [O comandos próprios]. */
const REMOVABLE = new Set<string>([
  ...TASK_CLASS_LIST, "SourceLandType", "DestLandType", "WorkType", "Unit", "SumTask", "Note", "Dependency", "Calendar", "Milestone", "ViewFilter",
  "MainSchedule", "RoadConnection", "RoadLine", "Area", "UsageBreak", "WorkGroup", "NullWorkGroup", "PriceVector", "Resource", "Transporter",
  "IdentifiedResource", "MovableWorkPlace", "OtherWorkPlace", "Image", "TypeDependency",
]);

export interface RemovalNode {
  oid: string;
  class: string;
  name: string;
  /** por que cai junto (o que ele referencia e que está sendo removido) */
  via?: string;
  dependents: RemovalNode[];
}
export interface RemovalPreview {
  /** árvore de dependentes (`RemoveDialog` + `GenerateSuiciderTree@00642770`) */
  tree: RemovalNode[];
  /** total de objetos de dados que somem (sem os filhos internos: locais de tarefa, layouts, fontes, transportes…) */
  count: number;
  /** recusas, com a mensagem do original */
  refused: { oid: string; class: string; name: string; message: string }[];
}

/** Recusa de remoção direta (§11.1, `Project::Remove*`) [O]. */
function refusal(p: Project, e: Entity): MessageCode | undefined {
  const root = projectRoot(p);
  if (e.oid === root.oid || !REMOVABLE.has(e.className)) return "NOT_REMOVABLE";
  if (e.oid === asRef(root.get("m_pRootSumTask"))) return "CANT_REMOVE_ROOT_SUM_TASK";
  if (e.className === "MainSchedule" || e.oid === asRef(root.get("m_pMainSchedule"))) return "CANT_REMOVE_MAIN_SCHEDULE";
  if (e.className === "Unit" && isMassUnit(p, e)) return "DEFAULT_UNIT_CANNOT_BE_REMOVED";
  if (e.className === "Calendar" && defaultCalendar(p)?.oid === e.oid) return "CANT_REMOVE_DEFAULT_CALENDAR";
  if (e.className === "Dependency" && e.get("m_bUserGenerated") !== true) return "TYPE_DERIVED_DEPENDENCY_CANNOT_BE_REMOVED";
  if (e.className === "NullWorkGroup" || e.oid === asRef(root.get("m_pNullWorkGroup"))) return "DEFAULT_WORK_GROUP";
  return undefined;
}

/**
 * `KernelObject::GetSuiciders` — quem morre junto (`SuicideWhenDeleted` registrado nos `RestoreSubjects`, §11.2):
 * - [O] SourceLandType ← seu PriceVector; PriceVector, tipos e Transporter ← sua Unit;
 * - [O] RoadLineBase filha e Shape ← a Area pai; IntersectionSetting ← a road line ou a interceptada;
 *   RoadConnection ← a road line de cada ponta; TypeDependency ← tipo predecessor e sucessor;
 * - [I] WorkSite ← cada tipo que usa e a road line/área do 1º work place; dependências ← as tarefas das pontas;
 * - [I] UsageBreak ← sua road line (pertence a `m_usageBreaks`); IdentifiedResource ← seu Resource
 *   (`Project::RemoveResource@00911080` remove antes) [O];
 * - work place cujo local cai (não o 1º) → só ele sai da tarefa [I].
 */
function suicidersOf(p: Project, e: Entity, all: readonly Entity[]): Entity[] {
  const out: Entity[] = [];
  const r = (x: Entity, m: string) => x.members().includes(m) && x.get(m) === e.oid;
  switch (e.className) {
    case "Unit":
      for (const x of all) if (["PriceVector", "SourceLandType", "DestLandType", "WorkType", "Transporter"].includes(x.className) && r(x, "m_pUnit")) out.push(x);
      break;
    case "PriceVector":
      for (const x of all) if (x.className === "SourceLandType" && r(x, "m_pPriceVector")) out.push(x);
      break;
    case "SourceLandType": case "DestLandType": case "WorkType":
      for (const x of all) {
        if (isTask(x) && typesOfTask(p, x).some((t) => t.oid === e.oid)) out.push(x);
        else if (x.className === "TypeDependency" && (r(x, "m_pPredecessor") || r(x, "m_pSuccessor"))) out.push(x);
      }
      break;
    case "RoadLine": case "Area":
      for (const x of all) {
        if (isTask(x) && roadLineOfTask(p, x)?.oid === e.oid) out.push(x);
        else if ((x.className === "RoadLine" || x.className === "Area") && r(x, "m_pAreaParent")) out.push(x);
        else if (x.className === "PolygonShape" && r(x, "m_pArea")) out.push(x);
        else if (x.className === "IntersectionSetting" && (r(x, "m_pRoadLine") || r(x, "m_pIntersectingRoadLine"))) out.push(x);
        else if (x.className === "UsageBreak" && r(x, "m_pRoadLine")) out.push(x);
        else if (x.className === "RoadConnection") {
          const ends = [x.get("m_pPlaceFrom"), x.get("m_pPlaceTo")].map((o) => p.resolve(asRef(o)));
          if (ends.some((pl) => pl?.get("m_pRoadLine") === e.oid)) out.push(x);
        } else if ((x.className === "MovableWorkPlace" || x.className === "OtherWorkPlace") && locationOf(p, x)?.get("m_pRoadLine") === e.oid) {
          const t = p.resolve(asRef(x.get("m_pWorkSite")));
          if (t && roadLineOfTask(p, t)?.oid !== e.oid) out.push(x);
        }
      }
      break;
    case "Resource":
      for (const x of all) if (x.className === "IdentifiedResource" && r(x, "m_pResource")) out.push(x);
      break;
    default:
      if (isTask(e)) for (const x of all) if (x.className === "Dependency" && (r(x, "m_pPredecessor") || r(x, "m_pSuccessor"))) out.push(x);
  }
  // U-46: `Note::GlueTo` registra `SuicideWhenDeleted(obj)` — a nota colada morre com o objeto [O]
  for (const x of all) if (x.className === "Note" && r(x, "m_pGluedObject")) out.push(x);
  return out;
}

/** Work place pedido: o único da tarefa leva a tarefa (§11.1) [I]. */
function effectiveTarget(p: Project, e: Entity): Entity {
  if (e.className === "MovableWorkPlace" || e.className === "OtherWorkPlace") {
    const t = p.resolve(asRef(e.get("m_pWorkSite")));
    if (t && workPlacesOf(p, t).length <= 1) return t;
  }
  return e;
}

const viaText = (p: Project, x: Entity, parent: Entity): string => {
  for (const m of x.members()) {
    const v = x.get(m);
    if (v === parent.oid || (Array.isArray(v) && (v as unknown[]).includes(parent.oid))) return m;
  }
  return parent.className;
};

/**
 * Pré-visualização da remoção (o que o `RemoveDialog@00641be0` mostra antes de "Are you sure you want to remove all the
 * listed items?", 14551) e lista do que cai. Não altera o projeto.
 */
export function previewRemoval(p: Project, objects: readonly Entity[]): RemovalPreview & { dead: Entity[] } {
  const all = [...p.entities()];
  const seen = new Set<bigint>();
  const dead: Entity[] = [];
  const refused: RemovalPreview["refused"] = [];
  const build = (e: Entity, parent?: Entity): RemovalNode | undefined => {
    if (seen.has(e.oid)) return undefined;
    seen.add(e.oid);
    dead.push(e);
    const node: RemovalNode = { oid: e.oid.toString(), class: e.className, name: e.name, ...(parent ? { via: viaText(p, e, parent) } : {}), dependents: [] };
    for (const x of suicidersOf(p, e, all)) {
      const n = build(x, e);
      if (n) node.dependents.push(n);
    }
    return node;
  };
  const tree: RemovalNode[] = [];
  for (const o of objects) {
    const target = effectiveTarget(p, o);
    const why = refusal(p, target);
    if (why) {
      refused.push({ oid: target.oid.toString(), class: target.className, name: target.name, message: MESSAGES[why] });
      continue;
    }
    const n = build(target);
    if (n) tree.push(n);
  }
  // `IsMainRoadLineEndangered@0090f920`: a linha principal não pode cair, nem por cascata [O]
  const main = mainRoadLine(p);
  if (seen.has(main.oid) && !refused.some((x) => x.oid === main.oid.toString())) {
    const culprit = tree.find((n) => n.oid === main.oid.toString() || JSON.stringify(n).includes(`"oid":"${main.oid}"`));
    refused.push({ oid: culprit?.oid ?? main.oid.toString(), class: culprit?.class ?? "RoadLine", name: culprit?.name ?? main.name, message: MESSAGES.CANT_REMOVE_MAIN_ROAD_LINE });
  }
  return { tree, count: dead.length, refused, dead };
}

/** Objetos de registro que somem quando referenciam o que cai (transportes, realizados) [P: o original os tira nos destrutores, I]. */
const RECORD_CLASSES = new Set(["LPMove", "SchedMove", "ImplUtilization", "ImplInfo", "OtherActual", "ActualsLocking"]);

/** OIDs referenciados por um valor. */
function refsIn(v: FieldValue, out: bigint[]): void {
  if (v.kind === "bigint" && v.type === FT.POINTER64 && v.value !== 0n) out.push(v.value);
  else if (v.kind === "int" && v.type === FT.POINTER32 && v.value !== 0) out.push(BigInt(v.value));
  else if (v.kind === "container" || v.kind === "tuple") for (const x of v.items) refsIn(x, out);
  else if (v.kind === "map") for (const [k, x] of v.entries) {
    refsIn(k, out);
    refsIn(x, out);
  }
}
const refsOf = (e: Entity): bigint[] => {
  const out: bigint[] = [];
  for (const f of e.fields) refsIn(f.value, out);
  return out;
};

/** Tira as referências aos mortos: ponteiro → nulo; item de contêiner e entrada de mapa (chave ou valor) somem (como delete_objects, U-22). */
function scrub(v: FieldValue, dead: ReadonlySet<bigint>): FieldValue | undefined {
  const isDead = (x: FieldValue) => (x.kind === "bigint" && x.type === FT.POINTER64 && dead.has(x.value)) || (x.kind === "int" && x.type === FT.POINTER32 && dead.has(BigInt(x.value)));
  if (isDead(v)) return v.kind === "bigint" ? { ...v, value: 0n } : v.kind === "int" ? { ...v, value: 0 } : v;
  if (v.kind === "container" || v.kind === "tuple") {
    let changed = false;
    const items: FieldValue[] = [];
    for (const x of v.items) {
      if (v.kind === "container" && isDead(x)) {
        changed = true;
        continue;
      }
      const y = scrub(x, dead);
      if (y) changed = true;
      items.push(y ?? x);
    }
    return changed ? { ...v, items } : undefined;
  }
  if (v.kind === "map") {
    let changed = false;
    const entries: [FieldValue, FieldValue][] = [];
    for (const [k, x] of v.entries) {
      if (isDead(k) || isDead(x)) {
        changed = true;
        continue;
      }
      const y = scrub(x, dead);
      if (y) changed = true;
      entries.push([k, y ?? x]);
    }
    return changed ? { ...v, entries } : undefined;
  }
  return undefined;
}

/** Alcançáveis a partir do objeto Project (o que vai para o arquivo, RN-025). */
function reachable(p: Project): Set<bigint> {
  const root = projectRoot(p);
  const seen = new Set<bigint>([root.oid]);
  const stack = [root];
  while (stack.length) {
    const e = stack.pop()!;
    for (const o of refsOf(e)) {
      if (seen.has(o)) continue;
      const x = p.get(o);
      if (!x) continue;
      seen.add(o);
      stack.push(x);
    }
  }
  return seen;
}

export interface RemovalResult {
  removed: { oid: string; class: string; name: string }[];
  /** objetos internos removidos junto (locais de tarefa, layouts, fontes, transportes calculados…) */
  internal: number;
  warning?: string;
}

/**
 * `RemoveCommand(project, objetos)@00641b20` → `ProjectHelpers::Remove@00910c70`: o visitor `Remover@00908b70` em cada
 * objeto ainda vivo [O], com as ações de cada classe (§11.1):
 * - SumTask: `Project::RemoveSumTask(s, false)@00911270` — filhas (tarefas e sum tasks) sobem para o pai [O];
 * - Calendar: tarefas que o usam voltam ao padrão [I]; WorkGroup: equipes das tarefas re-escolhidas [I];
 * - Dependency do usuário: `DependencyManager::RemoveDependencyImpl@009a4910` [O];
 * - demais: delete com a cascata de `previewRemoval`; referências dos sobreviventes limpas; filhos internos que ficam
 *   inalcançáveis (locais, work places, layouts, fontes, caminhos, transportes que tocam o que caiu) removidos [P].
 * Qualquer recusa lança a mensagem do original e nada é removido (o nível de undo é desfeito) [I, C-05].
 */
export function removeObjects(p: Project, objects: readonly Entity[]): RemovalResult {
  const plan = previewRemoval(p, objects);
  if (plan.refused.length) {
    const r = plan.refused[0]!;
    const code = (Object.keys(MESSAGES) as MessageCode[]).find((k) => MESSAGES[k] === r.message) ?? "NOT_REMOVABLE";
    fail(code, `${r.class} "${r.name}" (${r.oid})`);
  }
  const before = reachable(p);
  const dead = new Set(plan.dead.map((e) => e.oid));
  const touchedTasks = plan.dead.some((e) => isTask(e) || e.className === "Dependency" || e.className.endsWith("WorkPlace"));
  // ações por classe, antes de limpar referências
  for (const e of plan.dead) {
    if (e.className === "SumTask") {
      const parent = p.resolve(asRef(e.get("m_pParent"))) ?? rootSumTask(p);
      for (const c of refs(e.get("m_vpChildren")).map((o) => p.get(o)).filter((x): x is Entity => !!x && !dead.has(x.oid))) setSumTaskParent(p, c, parent);
      const cont = p.resolve(asRef(e.get("m_pWorkSiteContainer")));
      for (const k of TASK_CLASS_LIST) for (const o of refs(cont?.get(CONTAINER_LIST[k]))) {
        const t = p.get(o);
        if (t && !dead.has(t.oid)) setTaskSumTask(p, t, parent);
      }
    } else if (e.className === "Calendar") {
      const def = defaultCalendar(p);
      for (const t of allTasks(p)) if (t.get("m_pCalendar") === e.oid && def) {
        t.set("m_pCalendar", def.oid);
        t.set("m_bUseDefaultCalendar", true);
      }
    } else if (e.className === "RoadLine" || e.className === "Area") {
      orderHelperRemove(p, new Set([e.oid]));
    }
  }
  // work places de tarefas que caem e os transportes/realizados que tocam o que cai
  for (const e of [...plan.dead]) if (isTask(e)) for (const w of workPlacesOf(p, e)) dead.add(w.oid);
  for (let changed = true; changed;) {
    changed = false;
    for (const x of p.entities()) {
      if (dead.has(x.oid) || !RECORD_CLASSES.has(x.className)) continue;
      const deep = [...refsOf(x)];
      const path = p.resolve(asRef(x.members().includes("m_pPath") ? x.get("m_pPath") : null));
      if (path) for (const n of refs(path.get("m_vpNodes"))) deep.push(...refsOf(p.get(n) ?? path));
      if (deep.some((o) => dead.has(o))) {
        dead.add(x.oid);
        changed = true;
      }
    }
  }
  // `HasVariantTiming::OnDependentBegin/EndWorkSiteDeleted@0x973410/@0x973450` [O, U-10]: tempo TASK (2) ligado a uma
  // tarefa que cai vira STATIC (1); a data gravada fica [I]. A referência é zerada pela limpeza abaixo.
  for (const x of [...p.byClass("UsageBreak"), ...p.byClass("RoadConnection")]) {
    if (dead.has(x.oid)) continue;
    for (const [m, tt] of [["m_pBeginWorkSite", "m_beginTimingType"], ["m_pEndWorkSite", "m_endTimingType"]] as const) {
      const w = asRef(x.get(m));
      if (w !== null && dead.has(w) && num(x.get(tt)) === 2) x.set(tt, 1);
    }
  }
  // limpa as referências dos sobreviventes
  for (const e of [...p.entities()]) {
    if (dead.has(e.oid)) continue;
    let fields = e.fields, changed = false;
    fields = fields.map((f) => {
      const v = scrub(f.value, dead);
      if (!v) return f;
      changed = true;
      return { ...f, value: v };
    });
    if (changed) e.replaceFields(fields);
  }
  const removed = plan.dead.map((e) => ({ oid: e.oid.toString(), class: e.className, name: e.name }));
  for (const o of dead) {
    const x = p.get(o);
    if (x) p.remove(x);
  }
  // filhos internos que ficaram inalcançáveis (eram alcançáveis antes)
  const after = reachable(p);
  let internal = dead.size - plan.dead.length;
  for (const o of before) {
    if (after.has(o)) continue;
    const x = p.get(o);
    if (!x) continue;
    p.remove(x);
    internal++;
  }
  // equipes re-escolhidas (crews removidas) e datas
  for (const t of allTasks(p)) selectSuitableWorkGroups(p, t);
  const warning = touchedTasks ? afterTaskChange(p) : undefined;
  return { removed, internal, ...(warning ? { warning } : {}) };
}

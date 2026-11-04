/**
 * Migração para a versão gravada (RN-026, D-004, D-016). Só as migrações necessárias aos exemplos antigos
 * (DE, clientes 70017 e 70018); abaixo de 70017 lança UNSUPPORTED_MIGRATION em vez de inventar.
 * Evidência: docs/analise_persistencia_dpl.md §4.3.
 *
 * O que o original faz ao abrir e salvar um arquivo < 80006, e o que é feito aqui:
 * - [O] strings 0x16 (UTF-16) passam a 0x0F (UTF-8): "Abrir e salvar um arquivo antigo converte tudo".
 * - [O] a classe 157 (SiteLink) e `SourceLandType` f406 "somem no próximo salvamento".
 * - [O] referências a OID ausente ou de classe removida ficam nulas (RN-025).
 * - [O] < 80006 (`0x13886` no VALIDATE de `Project_ManageState@0090fc80`): o original cria um `HaulImportSettings`
 *   (classe 155) com os valores do construtor, liga-o ao Project (f299) e copia os campos antigos (Project
 *   f277–f290 e f295–f298, e o SiteLink) por `HaulImportSettingsHelpers::RestoreOld` @0x0091d600 →
 *   `RestoreSiteLinkProject`/`RestoreLeicaProject`. Aqui o objeto é criado com os valores do construtor (os do OID 392
 *   de `en/default.dr5`, U-28) [O]; os campos antigos são **descartados** (importação de transportes fora do escopo,
 *   D-003/D-010) [P], então um projeto SiteLink/Leica antigo não leva as credenciais nem o servidor. A senha em texto
 *   claro (f279) nunca é copiada.
 * - [O] < 80004 (`0x13884`): `ImplManager::RecreateUtilizations(null, {})`. O modelo não depende do motor: a migração
 *   só marca `recreateUtilizations` e quem abre o arquivo (app `core/io.ts`, CLI `convert --migrate`) chama
 *   `recreateUtilizations` do motor fora do undo (U-53). Sem `ImplInfo` não há efeito.
 * - [O] < 80002 (`0x13882`): toda road line de `Project.m_vpRoadLines` que não está na ordem dos polígonos
 *   (`UIManager.m_pPolygonOrderHelper`, `OrderHelper` 154) entra no fim (`OrderHelper::AddItem(rl, false)`). A ordem é a
 *   lista encadeada do bimap f200 (anterior → seguinte; 0 = início/fim), como em `en/default.dr5` OID 294.
 * - [I] ponteiros 0x11/0x12 passam a 0x18 (o original grava ponteiros com `PointerWrite`, FT_POINTER64).
 * - [O] DV-010: `UISettingsContainer` (classe 143) f200 — abaixo de 80005 é `map<int,bool>` e o original o
 *   converte para `m_settings` `map<int, variant<bool,int,double>>` com o bool na alternativa 0
 *   (`UISettingsContainer_ManageState@009ab640`, evidencias/decompilado/manage_state/). Gravado como variant
 *   0x19 `[i32 0, bool]`, igual aos 80006 nativos (en/default.dr5, OIDs 16 e 22).
 */
import { encodeString, decodeString, FT, PROJECT_CLASS_ID, WRITE_CLIENT_VERSION, WRITE_FORMAT, type Field, type FieldValue } from "@apex/dr5";
import { ModelError } from "./errors.js";
import type { Project } from "./project.js";

export const OLDEST_MIGRATABLE = 70017;
const SITELINK_CLASS = 157;
const SOURCE_LAND_TYPE_CLASS = 48;
const UI_SETTINGS_CONTAINER_CLASS = 143;
const UI_SETTINGS_VARIANT_VERSION = 80005;
const HAUL_IMPORT_SETTINGS_CLASS = 155;
const HAUL_IMPORT_SETTINGS_VERSION = 80006; // 0x13886
const POLYGON_ORDER_VERSION = 80002; // 0x13882
const UTILIZATIONS_VERSION = 80004; // 0x13884
const PROJECT_HAUL_IMPORT_SETTINGS_FIELD = 299;
const PROJECT_ROAD_CONNECTIONS_FIELD = 294;
const UI_MANAGER_POLYGON_ORDER_FIELD = 221;
const ORDER_HELPER_ITEMS_FIELD = 200;

const ptr = (oid: bigint): FieldValue => ({ kind: "bigint", type: FT.POINTER64, value: oid });
const emptyStr = (): FieldValue => encodeString("");
const i32 = (value: number): FieldValue => ({ kind: "int", type: FT.SINT, value });
const dbl = (value: number): FieldValue => ({ kind: "float", type: FT.DOUBLE, value, raw: new Uint8Array(0) });

/** `HaulImportSettings::HaulImportSettings` (valores do OID 392 de `en/default.dr5`, 80006 nativo) [O]. */
function haulImportSettingsFields(): Field[] {
  const f = (id: number, value: FieldValue): Field => ({ id, type: value.type, value });
  return [
    f(100, emptyStr()),
    f(101, emptyStr()),
    f(104, ptr(0n)),
    f(200, i32(0)), // m_nServerType
    f(201, i32(0)), // m_nCoordinateSystem
    f(202, i32(0)), // m_nCombinationInterval
    f(203, { kind: "map", type: FT.PAIR_CONTAINER, keyType: null, valueType: null, entries: [] }), // m_serverSettings
    f(204, { kind: "int", type: FT.BOOL, value: 0 }), // m_bAreaFiltering
    f(205, dbl(0)),
    f(206, dbl(0)),
    f(207, dbl(0)),
    f(208, dbl(0)),
    f(209, { kind: "map", type: FT.PAIR_CONTAINER, keyType: null, valueType: null, entries: [] }), // m_mMaterialMappings
    f(210, { kind: "container", type: FT.CONTAINER, elemType: null, items: [] }), // m_sUnimportedMaterialIDs
    // m_lastDateSpan: (2999-12-31 23:59:59, 1998-01-01 00:00:00)
    f(211, { kind: "tuple", type: FT.TUPLE, items: [{ kind: "bigint", type: FT.SINT64, value: 32503679999n }, { kind: "bigint", type: FT.SINT64, value: 883612800n }] }),
  ];
}

const refOf = (v: FieldValue | undefined): bigint | null => (v && v.kind === "bigint" && (v.type === FT.POINTER64 || v.type === FT.POINTER32) ? v.value : v && v.kind === "int" && v.type === FT.POINTER32 ? BigInt(v.value) : null);

/** Itens da ordem (lista encadeada do bimap anterior → seguinte; 0 = início/fim). */
export function orderItems(items: FieldValue | undefined): bigint[] {
  if (!items || items.kind !== "map") return [];
  const next = new Map<bigint, bigint>();
  for (const [k, v] of items.entries) {
    const a = refOf(k), b = refOf(v);
    if (a !== null && b !== null) next.set(a, b);
  }
  const out: bigint[] = [];
  for (let cur = next.get(0n) ?? 0n; cur !== 0n && !out.includes(cur) && out.length <= next.size; cur = next.get(cur) ?? 0n) out.push(cur);
  return out;
}

/** `OrderHelper::AddItem(obj, false)`: põe no fim da lista encadeada. */
function appendToOrder(items: Extract<FieldValue, { kind: "map" }>, oid: bigint): Extract<FieldValue, { kind: "map" }> {
  const list = orderItems(items);
  const last = list.length ? list[list.length - 1]! : 0n;
  const entries = items.entries.filter(([k]) => refOf(k) !== last);
  entries.push([ptr(last), ptr(oid)], [ptr(oid), ptr(0n)]);
  return { ...items, keyType: FT.POINTER64, valueType: FT.POINTER64, entries };
}
/**
 * Ids legados do Project (OldHaulImportSettings e o SiteLink f295), exatamente os da tabela de campos
 * (dpl_ids_campos.tsv). DV-009: f293 m_pQuantityImportSettings e f294 m_vpRoadConnections ficam no meio
 * dessa faixa e são campos atuais; não podem ser apagados.
 */
export const LEGACY_PROJECT_FIELDS: ReadonlySet<number> = new Set([277, 278, 279, 280, 282, 283, 284, 285, 286, 287, 288, 289, 290, 295, 296, 297, 298]);

export interface MigrationReport {
  from: number;
  to: number;
  stringsConverted: number;
  pointersConverted: number;
  removedObjects: number;
  removedFields: number;
  nulledReferences: number;
  /** DV-010: mapas map<int,bool> do UISettingsContainer convertidos para variant. */
  settingsConverted: number;
  /** U-28: objetos criados pelo VALIDATE do Project (HaulImportSettings, < 80006). */
  createdObjects: number;
  /** U-28: road lines acrescentadas à ordem dos polígonos (< 80002). */
  orderedRoadLines: number;
  /** U-53: < 80004 — o chamador refaz as utilizações (`ImplManager::RecreateUtilizations`, motor). */
  recreateUtilizations: boolean;
}

function mapValue(v: FieldValue, present: Set<bigint>, r: MigrationReport): FieldValue {
  switch (v.kind) {
    case "bytes":
      if (v.type === FT.WSTRING_OLD) {
        r.stringsConverted++;
        return encodeString(decodeString(v));
      }
      if (v.type === FT.REFERENCE_OLD && v.value.length === 4) {
        r.pointersConverted++;
        return ref(BigInt(new DataView(v.value.buffer, v.value.byteOffset, 4).getUint32(0, true)), present, r);
      }
      return v;
    case "int":
      if (v.type === FT.POINTER32) {
        r.pointersConverted++;
        return ref(BigInt(v.value), present, r);
      }
      return v;
    case "bigint":
      return v.type === FT.POINTER64 ? ref(v.value, present, r) : v;
    case "container": {
      const items = v.items.map((x) => mapValue(x, present, r));
      return { ...v, elemType: items[0]?.type ?? v.elemType, items };
    }
    case "map": {
      const entries = v.entries.map(([a, b]) => [mapValue(a, present, r), mapValue(b, present, r)] as [FieldValue, FieldValue]);
      return { ...v, keyType: entries[0]?.[0].type ?? v.keyType, valueType: entries[0]?.[1].type ?? v.valueType, entries };
    }
    case "tuple":
      return { ...v, items: v.items.map((x) => mapValue(x, present, r)) };
    default:
      return v;
  }
}

function ref(oid: bigint, present: Set<bigint>, r: MigrationReport): FieldValue {
  if (oid !== 0n && !present.has(oid)) {
    r.nulledReferences++;
    return { kind: "bigint", type: FT.POINTER64, value: 0n };
  }
  return { kind: "bigint", type: FT.POINTER64, value: oid };
}

/**
 * Leva o projeto a 0x803 + 80006. Fora do undo: é uma conversão de carga, feita uma vez ao abrir.
 * Projeto já em 80006 não muda.
 */
function boolMapToVariant(v: Extract<FieldValue, { kind: "map" }>, r: MigrationReport): FieldValue {
  r.settingsConverted++;
  return {
    ...v,
    valueType: FT.VARIANT,
    entries: v.entries.map(([k, b]) => [k, { kind: "tuple", type: FT.VARIANT, items: [{ kind: "int", type: FT.SINT, value: 0 }, b] }] as [FieldValue, FieldValue]),
  };
}

export function migrateToCurrent(p: Project): MigrationReport {
  const r: MigrationReport = { from: p.clientVersion, to: p.clientVersion, stringsConverted: 0, pointersConverted: 0, removedObjects: 0, removedFields: 0, nulledReferences: 0, settingsConverted: 0, createdObjects: 0, orderedRoadLines: 0, recreateUtilizations: false };
  if (p.clientVersion >= WRITE_CLIENT_VERSION) return r;
  if (p.clientVersion < OLDEST_MIGRATABLE) {
    throw new ModelError("UNSUPPORTED_MIGRATION", `migração da versão ${p.clientVersion} não implementada (mínimo ${OLDEST_MIGRATABLE}, D-004)`);
  }
  const doomed = [...p.entities()].filter((e) => e.classId === SITELINK_CLASS);
  for (const e of doomed) p.drop(e.oid);
  r.removedObjects = doomed.length;
  const present = new Set([...p.entities()].map((e) => e.oid));
  for (const e of p.entities()) {
    let fields: Field[] = e.fields;
    const before = fields.length;
    if (e.classId === PROJECT_CLASS_ID) fields = fields.filter((f) => !LEGACY_PROJECT_FIELDS.has(f.id));
    if (e.classId === SOURCE_LAND_TYPE_CLASS) fields = fields.filter((f) => f.id !== 406);
    r.removedFields += before - fields.length;
    if (e.classId === UI_SETTINGS_CONTAINER_CLASS && p.clientVersion < UI_SETTINGS_VARIANT_VERSION) {
      fields = fields.map((f) => (f.id === 200 && f.value.kind === "map" && f.value.valueType === FT.BOOL ? { ...f, value: boolMapToVariant(f.value, r) } : f));
    }
    e.fields = fields.map((f) => {
      const value = mapValue(f.value, present, r);
      return { id: f.id, type: value.type, value };
    });
  }
  validateProject(p, r);
  r.recreateUtilizations = p.clientVersion < UTILIZATIONS_VERSION && p.byClass("ImplInfo").length > 0;
  p.formatVersion = WRITE_FORMAT;
  p.clientVersion = WRITE_CLIENT_VERSION;
  r.to = WRITE_CLIENT_VERSION;
  return r;
}

/** VALIDATE de `Project_ManageState@0090fc80` dependente da versão (ver o cabeçalho). Roda depois da conversão dos campos. */
function validateProject(p: Project, r: MigrationReport): void {
  const root = p.root();
  if (!root) return;
  if (p.clientVersion < HAUL_IMPORT_SETTINGS_VERSION && refOf(root.fields.find((f) => f.id === PROJECT_HAUL_IMPORT_SETTINGS_FIELD)?.value) === null) {
    let max = 0n;
    for (const e of p.entities()) if (e.oid > max) max = e.oid;
    const his = p.insert(max + 1n, HAUL_IMPORT_SETTINGS_CLASS, haulImportSettingsFields());
    r.createdObjects++;
    const field: Field = { id: PROJECT_HAUL_IMPORT_SETTINGS_FIELD, type: FT.POINTER64, value: ptr(his.oid) };
    const at = root.fields.findIndex((f) => f.id === PROJECT_ROAD_CONNECTIONS_FIELD);
    root.fields = at >= 0 ? [...root.fields.slice(0, at + 1), field, ...root.fields.slice(at + 1)] : [...root.fields, field];
  }
  if (p.clientVersion < POLYGON_ORDER_VERSION) {
    const ui = p.resolve(refOf(root.field("m_pUIManager")?.value));
    const helper = ui && p.resolve(refOf(ui.fields.find((f) => f.id === UI_MANAGER_POLYGON_ORDER_FIELD)?.value));
    if (helper) {
      const idx = helper.fields.findIndex((f) => f.id === ORDER_HELPER_ITEMS_FIELD);
      let items: Extract<FieldValue, { kind: "map" }> = idx >= 0 && helper.fields[idx]!.value.kind === "map" ? (helper.fields[idx]!.value as Extract<FieldValue, { kind: "map" }>) : { kind: "map", type: FT.PAIR_CONTAINER, keyType: null, valueType: null, entries: [] };
      const listed = new Set(orderItems(items));
      const roadLines = root.field("m_vpRoadLines")?.value;
      for (const v of roadLines && roadLines.kind === "container" ? roadLines.items : []) {
        const oid = refOf(v);
        if (oid === null || oid === 0n || listed.has(oid) || !p.get(oid)) continue;
        items = appendToOrder(items, oid);
        listed.add(oid);
        r.orderedRoadLines++;
      }
      const field: Field = { id: ORDER_HELPER_ITEMS_FIELD, type: items.type, value: items };
      helper.fields = idx >= 0 ? helper.fields.map((f, i) => (i === idx ? field : f)) : [...helper.fields, field];
    }
  }
}

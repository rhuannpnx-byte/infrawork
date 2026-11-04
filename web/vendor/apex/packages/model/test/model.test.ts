// U-03: modelo de domínio. CA do PLANO: ida e volta .dr5 → modelo → .dr5 idêntica nos 27; .apex.json com
// hash; undo de 10 níveis com Trim; mensagens de validação iguais às strings do original.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeString, FT, readDr5, writeContainer, type FieldValue } from "../../dr5/src/index.js";
import { FIXTURES, oracleFiles, ROOT } from "../../dr5/test/helpers.js";
import {
  checkLocationLength, checkRoadLineLength, checkStationSpan, checkTaskLocations, checkCenterStation,
  encodeContainer, LEGACY_PROJECT_FIELDS, MAX_UNDO_LEVELS, migrateToCurrent, orderItems, Project, sha256, VALIDATION_MESSAGES, type ChangeEvent,
} from "../src/index.js";

const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const simpleBytes = new Uint8Array(readFileSync(join(FIXTURES, "example_simple_road_project.dr5")));
const load = () => Project.fromDr5(readDr5(simpleBytes));
const toFile = (p: Project) => writeContainer(p.toDpl());
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};

describe("CA U-03: ida e volta sem perda nos 27 .dr5", () => {
  for (const { entry, path } of oracleFiles()) {
    it(`${entry.file}: .dr5 → modelo → .dr5 e .dr5 → .apex.json → .dr5 idênticos`, () => {
      const raw = new Uint8Array(readFileSync(path));
      const p = Project.fromDr5(readDr5(raw));
      expect(sha(toFile(p))).toBe(entry.sha256);
      const json = p.toNativeJson();
      expect(sha(toFile(Project.fromNativeJson(json)))).toBe(entry.sha256);
    });
  }
});

describe(".apex.json: esquema e SHA-256", () => {
  const json = load().toNativeJson();
  it("cabeçalho, versão do .dr5 e hash do conteúdo", () => {
    const o = JSON.parse(json);
    expect([o.format, o.schema, o.dr5]).toEqual(["apex-project", 1, { formatVersion: 0x803, clientVersion: 80006 }]);
    const { sha256: h, ...rest } = o;
    expect(h).toBe(sha(JSON.stringify(rest)));
    expect(o.objects).toHaveLength(577);
  });
  it("conteúdo alterado sem atualizar o hash é recusado (INTEGRITY); esquema desconhecido também", () => {
    expect(codeOf(() => Project.fromNativeJson(json.replace('"Owner"', '"Dono"')))).toBe("INTEGRITY");
    expect(codeOf(() => Project.fromNativeJson(json.replace('"schema": 1', '"schema": 2')))).toBe("NATIVE_FORMAT");
    expect(codeOf(() => Project.fromNativeJson("{"))).toBe("NATIVE_FORMAT");
  });
  it("valores que o JSON não representa direto voltam idênticos (NaN com payload, −0, string inválida)", () => {
    const p = load();
    const nan = new Uint8Array([1, 0, 0, 0, 0, 0, 0xf8, 0x7f]);
    p.edit("t", () => {
      const e = p.create("Unit");
      e.setRaw("m_strName", { kind: "bytes", type: FT.STRING, value: Uint8Array.of(0xff, 0xfe, 0) });
      e.setRaw("m_strLongName", { kind: "bytes", type: FT.WSTRING_OLD, value: Uint8Array.of(0x41, 0, 0, 0) });
      const r = p.get(1n)!;
      r.setRaw("m_strOrderer", encodeString("ação ✓"));
      const pv = p.byClass("PriceVector")[0]!;
      pv.setRaw("m_distances", { kind: "map", type: 0x15, keyType: 0x0d, valueType: 0x0d, entries: [
        [{ kind: "float", type: 0x0d, value: -0, raw: new Uint8Array(0) }, { kind: "float", type: 0x0d, value: NaN, raw: nan }],
      ] });
    });
    const back = Project.fromNativeJson(p.toNativeJson());
    expect(sha(back.toDpl())).toBe(sha(p.toDpl()));
  });
});

describe("acesso tipado pelo nome do membro (RD-006…021, RF-007…024)", () => {
  const p = load();
  const root = p.root()!;
  it("Project (RD-006, RF-007/008): OID 1, modo, datas, unidades e listas", () => {
    expect(root.oid).toBe(1n);
    expect(root.className).toBe("Project");
    expect(root.get("m_strOrderer")).toBe("Owner");
    expect(root.get("m_strCreator")).toBe("Topcon / DynaRoad");
    expect(root.get("m_nMode")).toBeTypeOf("number");
    expect(root.get("m_dateBegin")).toBeTypeOf("bigint");
    const units = root.get("m_vpUnits") as bigint[];
    expect(units.map((u) => p.get(u)!.className)).toEqual(["Unit", "Unit", "Unit"]);
    expect(p.resolve(root.get("m_pCutUnit") as bigint)?.className).toBe("Unit");
  });
  it("tarefas e localização (RF-018, RD-007…010): LandCut 142 'LandCut 1' → work places → Location na road line", () => {
    const cut = p.get(142n)!;
    expect([cut.className, cut.name]).toEqual(["LandCut", "LandCut 1"]);
    const wp = p.get((cut.get("m_vpWorkPlaces") as bigint[])[0]!)!;
    expect(wp.className).toBe("MovableWorkPlace");
    const loc = p.resolve(wp.get("m_pLocation") as bigint)!;
    expect(loc.className).toBe("Location");
    const b = loc.get("m_dStationBegin") as number, e = loc.get("m_dStationEnd") as number;
    expect(checkLocationLength(b, e)).toBeNull();
    expect(p.resolve(loc.get("m_pRoadLine") as bigint)?.className).toBe("RoadLine");
    expect(p.resolve(cut.get("m_pSourceLandType") as bigint)?.className).toBe("SourceLandType");
  });
  it("tipos, custos, recursos, equipes, dependências e transportes (RF-009…014, RF-019…022)", () => {
    const slt = p.byClass("SourceLandType")[0]!;
    const conv = slt.get("m_conversions") as [bigint, number][];
    expect(conv.every(([u, f]) => p.get(u)?.className === "Unit" && f > 0)).toBe(true);
    const pv = p.byClass("PriceVector")[0]!;
    expect((pv.get("m_distances") as [number, number][]).length).toBeGreaterThan(0);
    // o exemplo simples não tem Transporter; o default.dr5 tem três (OID 296 "ADT 30", capacidade 30)
    const d = Project.fromDr5(readDr5(new Uint8Array(readFileSync(join(FIXTURES, "default.dr5")))));
    const tr = d.get(296n)!;
    expect([tr.className, tr.name, tr.get("m_dCapacity"), tr.get("m_dHourPrice")]).toEqual(["Transporter", "ADT 30", 30, 70]);
    expect((tr.get("m_mDistanceWorkAchievement") as [number, number][]).slice(0, 2)).toEqual([[50, 429], [100, 409]]);
    expect(p.byClass("WorkGroup").length).toBeGreaterThan(0);
    const dep = p.byClass("Dependency")[0];
    if (dep) expect([0, 1, 2, 3, 4]).toContain(dep.get("m_nType") ?? 0);
    expect(p.get(37n)!.name).toBe("Simple demo of basic features");
    expect(p.get(37n)!.className).toBe("SumTask");
    expect(p.byClass("LPMove").length + p.byClass("SchedMove").length).toBeGreaterThan(0);
  });
  it("membro desconhecido é erro; campo ausente é undefined", () => {
    expect(root.get("m_naoExiste")).toBeUndefined();
    expect(codeOf(() => p.edit("x", () => root.set("m_naoExiste", 1)))).toBe("UNKNOWN_MEMBER");
  });
});

describe("edição reproduz os arquivos que o original abriu (t2/t3 de 2026-10-11)", () => {
  it("t3: SumTask 37 renomeada pelo modelo → SHA-256 2a514689…800aa", () => {
    const p = load();
    p.edit("Rename", () => p.get(37n)!.set("m_strName", "REA lab: root sum task renamed (size changed)"));
    expect(sha(toFile(p))).toBe("2a5146897b719d4f836ebb82ee9a6af6debb777425bdd60ddf235ec2fe7800aa");
  });
  it("t2: LandCut 142 → 'REA-Cut 1' → SHA-256 4e5f6faa…1aca7", () => {
    const p = load();
    p.edit("Rename", () => p.get(142n)!.set("m_strName", "REA-Cut 1"));
    expect(sha(toFile(p))).toBe("4e5f6faa26053140865ad9f0f3a0a8ee570d835f345119ebdd6323964f91aca7");
  });
});

describe("undo/redo (RN-027, RF-004)", () => {
  it(`no máximo ${MAX_UNDO_LEVELS} níveis: o mais antigo sai`, () => {
    const p = load();
    for (let i = 1; i <= 12; i++) p.edit(`n${i}`, () => p.get(142n)!.set("m_strName", `nome ${i}`));
    expect(p.undoNames()).toEqual(["n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10", "n11", "n12"]);
    while (p.undo());
    expect(p.get(142n)!.name).toBe("nome 2");
  });
  it("Trim: nível que termina igual ao início não entra na pilha", () => {
    const p = load();
    p.edit("vai e volta", () => {
      p.get(142n)!.set("m_strName", "x");
      p.get(142n)!.set("m_strName", "LandCut 1");
    });
    expect(p.canUndo).toBe(false);
  });
  it("copy-on-write: duas mudanças no mesmo objeto, um nível; undo volta ao original byte a byte; redo reaplica", () => {
    const p = load();
    p.edit("duas", () => {
      p.get(142n)!.set("m_strName", "a");
      p.get(142n)!.set("m_strLongName", "b");
    });
    const edited = sha(toFile(p));
    expect(p.undo()).toBe(true);
    expect(sha(toFile(p))).toBe(sha(simpleBytes));
    expect(p.redo()).toBe(true);
    expect(sha(toFile(p))).toBe(edited);
  });
  it("criar e remover objetos; nova edição limpa o redo; eventos", () => {
    const p = load();
    const events: ChangeEvent[] = [];
    p.on((e) => events.push(e));
    const n = p.size;
    const maxBefore = [...p.entities()].reduce((m, e) => (e.oid > m ? e.oid : m), 0n);
    const u = p.edit("novo", () => {
      const e = p.create("Unit");
      e.set("m_strName", "m3");
      return e;
    });
    expect(p.size).toBe(n + 1);
    expect(u.oid).toBe(maxBefore + 1n); // RN-025: OID novo acima do maior existente
    p.edit("tira", () => p.remove(p.get(142n)!));
    expect(p.get(142n)).toBeUndefined();
    p.undo();
    expect(p.get(142n)!.name).toBe("LandCut 1");
    p.undo();
    expect(p.size).toBe(n);
    p.redo();
    expect(p.get(u.oid)!.name).toBe("m3");
    p.edit("outra", () => p.get(37n)!.set("m_strComment", "c"));
    expect(p.canRedo).toBe(false);
    expect(events.map((e) => e.kind)).toEqual(["commit", "commit", "undo", "undo", "redo", "commit"]);
    expect(events[1]!.oids).toEqual([142n]);
  });
  it("edição fora de um nível é recusada; erro no meio do nível desfaz o parcial", () => {
    const p = load();
    expect(codeOf(() => p.get(142n)!.set("m_strName", "x"))).toBe("NO_UNDO_LEVEL");
    expect(() => p.edit("falha", () => {
      p.get(142n)!.set("m_strName", "parcial");
      throw new Error("boom");
    })).toThrow("boom");
    expect(p.get(142n)!.name).toBe("LandCut 1");
    expect(p.canUndo).toBe(false);
  });
  it("contêiner de referências (setRaw/encodeContainer) também entra no undo", () => {
    const p = load();
    const root = p.root()!;
    const before = root.get("m_vpUnits") as bigint[];
    p.edit("units", () => root.setRaw("m_vpUnits", encodeContainer(FT.POINTER64, before.slice(0, 1))));
    expect(root.get("m_vpUnits")).toEqual(before.slice(0, 1));
    p.undo();
    expect(root.get("m_vpUnits")).toEqual(before);
  });
});

describe("migração dos arquivos antigos (RN-026, D-004, D-016)", () => {
  const de = oracleFiles().filter((f) => f.entry.client < 80006);
  it.skipIf(de.length === 0)("os 4 DE (70017/70018) passam a 0x803 + 80006, sem 0x16, sem classe 157, sem f277–f298; relidos sem erro", () => {
    expect(de.length).toBe(4);
    for (const { path } of de) {
      const p = Project.fromDr5(readDr5(new Uint8Array(readFileSync(path))));
      const names = new Map([...p.entities()].map((e) => [e.oid, e.name]));
      const r = migrateToCurrent(p);
      expect([r.from < 80006, r.to]).toEqual([true, 80006]);
      expect(r.stringsConverted).toBeGreaterThan(0);
      const back = readDr5(toFile(p));
      expect([back.formatVersion, back.clientVersion]).toEqual([0x803, 80006]);
      const tags = new Set<number>();
      const walk = (v: FieldValue) => {
        tags.add(v.type);
        if (v.kind === "container" || v.kind === "tuple") v.items.forEach(walk);
        if (v.kind === "map") v.entries.forEach(([a, b]) => (walk(a), walk(b)));
      };
      back.records.forEach((rec) => rec.fields.forEach((f) => walk(f.value)));
      expect(tags.has(0x16)).toBe(false);
      expect(back.records.some((rec) => rec.classId === 157)).toBe(false);
      const projectIds = back.records.find((rec) => rec.classId === 29)!.fields.map((f) => f.id);
      expect(projectIds.some((id) => LEGACY_PROJECT_FIELDS.has(id))).toBe(false);
      // DV-009: os campos atuais no meio da faixa legada continuam, e nenhum objeto além do SiteLink some
      const before = readDr5(new Uint8Array(readFileSync(path)));
      const had = (id: number) => before.records.find((rec) => rec.classId === 29)!.fields.some((f) => f.id === id);
      for (const id of [293, 294]) expect(projectIds.includes(id)).toBe(had(id));
      const lost = before.records.filter((rec) => !back.records.some((x) => x.oid === rec.oid)).map((rec) => rec.classId);
      expect(new Set(lost)).toEqual(new Set([157]));
      // os nomes que sobrevivem são os mesmos, agora em UTF-8
      const q = Project.fromDr5(back);
      for (const e of q.entities()) if (names.has(e.oid)) expect(e.name).toBe(names.get(e.oid));
      // U-28 (VALIDATE de Project_ManageState@0090fc80) [O]: < 80006 cria o HaulImportSettings do construtor e liga em f299
      expect(r.createdObjects).toBe(1);
      const his = q.byClass(155);
      expect(his).toHaveLength(1);
      expect(q.root()!.fields.find((f) => f.id === 299)?.value).toEqual({ kind: "bigint", type: 0x18, value: his[0]!.oid });
      expect(his[0]!.fields.map((f) => f.id)).toEqual([100, 101, 104, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211]);
      // < 80002: toda road line do projeto está na ordem dos polígonos
      const ui = q.resolve(q.root()!.get("m_pUIManager") as bigint)!;
      const helper = q.resolve(ui.get("m_pPolygonOrderHelper") as bigint)!;
      const order = orderItems(helper.fields.find((f) => f.id === 200)!.value);
      for (const rl of q.byClass("RoadLine")) expect(order).toContain(rl.oid);
      expect(new Set(order).size).toBe(order.length);
    }
  });
  it("U-28: um 80006 nativo já tem HaulImportSettings e a ordem; a migração não cria nada", () => {
    const p = load();
    const r = migrateToCurrent(p);
    expect([r.createdObjects, r.orderedRoadLines]).toEqual([0, 0]);
  });
  it("arquivo 80006 não muda; versão abaixo de 70017 é recusada", () => {
    const p = load();
    expect(migrateToCurrent(p).stringsConverted).toBe(0);
    expect(sha(toFile(p))).toBe(sha(simpleBytes));
    const old = Project.fromDr5({ ...readDr5(simpleBytes), clientVersion: 70016 });
    expect(codeOf(() => migrateToCurrent(old))).toBe("UNSUPPORTED_MIGRATION");
  });
});

describe("validações (RN-029): mensagens iguais às strings do original", () => {
  // DV-013: com APEX_ORACLES definido (alvo/Data da análise), a string table vem da mesma análise e o teste
  // não pode ser pulado; sem a variável, tenta o caminho relativo do laboratório.
  const strings = process.env.APEX_ORACLES
    ? resolve(process.env.APEX_ORACLES, "../../evidencias/strings_ui_en.txt")
    : resolve(ROOT, "../../../analises/2026-10-11_dynaroad/evidencias/strings_ui_en.txt");
  it.skipIf(!process.env.APEX_ORACLES && !existsSync(strings))("cada mensagem existe com o id esperado em strings_ui_en.txt", () => {
    const table = new Map(readFileSync(strings, "utf8").split(/\r?\n/).map((l) => l.split("\t")).map((c) => [c[0], c[2]]));
    expect(table.get("14052")).toBe(VALIDATION_MESSAGES.START_AFTER_FINISH);
    expect(table.get("14370")).toBe(VALIDATION_MESSAGES.LOCATION_ZERO_LENGTH);
    expect(table.get("14574")).toBe(VALIDATION_MESSAGES.ROAD_LINE_ZERO_LENGTH);
    expect(table.get("14758")).toBe(VALIDATION_MESSAGES.TASK_LOCATIONS_INTERSECT);
    expect(table.get("14839")).toBe(VALIDATION_MESSAGES.CENTER_AFTER_FINISH);
  });
  it("condições", () => {
    expect(checkStationSpan(10, 5)).toBe(VALIDATION_MESSAGES.START_AFTER_FINISH);
    expect(checkStationSpan(5, 10)).toBeNull();
    expect(checkCenterStation(11, 10)).toBe(VALIDATION_MESSAGES.CENTER_AFTER_FINISH);
    expect(checkRoadLineLength(3, 3)).toBe(VALIDATION_MESSAGES.ROAD_LINE_ZERO_LENGTH);
    expect(checkLocationLength(3, 3)).toBe(VALIDATION_MESSAGES.LOCATION_ZERO_LENGTH);
    const rl = 43n;
    expect(checkTaskLocations([{ roadLine: rl, begin: 0, end: 100 }, { roadLine: rl, begin: 50, end: 150 }])).toBe(VALIDATION_MESSAGES.TASK_LOCATIONS_INTERSECT);
    expect(checkTaskLocations([{ roadLine: rl, begin: 0, end: 100 }, { roadLine: rl, begin: 100, end: 150 }])).toBeNull();
    expect(checkTaskLocations([{ roadLine: rl, begin: 0, end: 100 }, { roadLine: 44n, begin: 50, end: 150 }])).toBeNull();
  });
});

describe("sha256 próprio = node:crypto", () => {
  it("vetores padrão e tamanhos na fronteira de bloco", () => {
    expect(sha256(new Uint8Array(0))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    for (const n of [55, 56, 63, 64, 65, 119, 1000, 100_000]) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);
      expect(sha256(b)).toBe(sha(b));
    }
  });
});

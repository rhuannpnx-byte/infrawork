// U-13: diferença por OID entre uma cópia calculada e o projeto da thread principal; subdocumento `ui` do .apex.json.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDr5 } from "../../dr5/src/index.js";
import { FIXTURES } from "../../dr5/test/helpers.js";
import { applyDiff, captureState, diffSince, isEmptyDiff, Project, readNativeUi } from "../src/index.js";

const simpleBytes = new Uint8Array(readFileSync(join(FIXTURES, "example_simple_road_project.dr5")));
const load = () => Project.fromDr5(readDr5(simpleBytes));
/** Objetos do .apex.json em ordem de OID (o undo de uma remoção devolve o objeto no fim do mapa). */
const canon = (text: string) =>
  text.split("\n").filter((l) => l.startsWith('    {"oid"')).map((l) => l.replace(/,$/, "")).sort().join("\n");
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};

/** Faz numa cópia (via .apex.json, como o worker) uma edição com criação, remoção e alteração. */
function computeOnCopy(main: Project) {
  const copy = Project.fromNativeJson(main.toNativeJson());
  const before = captureState(copy);
  const unit = copy.byClass("Unit")[0]!;
  const victim = copy.byClass("Unit")[1]!;
  let created = 0n;
  copy.edit("Haul calculation", () => {
    unit.set("m_strName", "renomeada");
    copy.remove(victim);
    created = copy.create("Unit").oid;
  });
  return { diff: diffSince(before, copy), unitOid: unit.oid, victimOid: victim.oid, created, after: copy.toNativeJson() };
}

describe("U-13: captureState/diffSince/applyDiff", () => {
  it("cópia sem alteração dá diferença vazia", () => {
    const copy = Project.fromNativeJson(load().toNativeJson());
    expect(isEmptyDiff(diffSince(captureState(copy), copy))).toBe(true);
  });

  it("aplica criados, removidos e alterados num nível de undo e o resultado é igual à cópia calculada", () => {
    const main = load();
    const { diff, unitOid, victimOid, created, after } = computeOnCopy(main);
    expect(diff.changed.map((c) => c.oid)).toContain(unitOid);
    expect(diff.removed.map((r) => r.oid)).toEqual([victimOid]);
    expect(diff.created.map((c) => c.oid)).toEqual([created]);
    const original = main.toNativeJson();
    main.edit("Haul calculation", () => applyDiff(main, diff));
    expect(main.toNativeJson()).toBe(after);
    expect(main.undoNames()).toEqual(["Haul calculation"]);
    // undo devolve exatamente o estado anterior; redo reaplica
    main.undo();
    expect(canon(main.toNativeJson())).toBe(canon(original));
    main.redo();
    expect(canon(main.toNativeJson())).toBe(canon(after));
  });

  it("OID criado na cópia que já foi usado e desfeito na principal (maxOid maior) ainda se aplica", () => {
    const main = load();
    main.edit("criar e desfazer", () => main.create("Unit"));
    main.undo(); // principal: maxOid avançou, mas o OID está livre
    const { diff, created } = computeOnCopy(main);
    main.edit("Haul calculation", () => applyDiff(main, diff));
    expect(main.get(created)?.className).toBe("Unit");
  });

  it("recusa com DIFF_CONFLICT se o objeto mudou na principal durante o cálculo, sem alterar nada", () => {
    const main = load();
    const { diff, unitOid } = computeOnCopy(main);
    main.edit("Edit name", () => main.get(unitOid)!.set("m_strName", "mexida durante o cálculo"));
    const before = main.toNativeJson();
    expect(codeOf(() => main.edit("Haul calculation", () => applyDiff(main, diff)))).toBe("DIFF_CONFLICT");
    expect(main.toNativeJson()).toBe(before);
    expect(main.undoNames()).toEqual(["Edit name"]);
  });

  it("recusa criar sobre OID existente e alterar OID ausente", () => {
    const main = load();
    const { diff } = computeOnCopy(main);
    const created = diff.created[0]!;
    main.edit("ocupa o OID", () => main.createAt(created.oid, "Unit"));
    expect(codeOf(() => main.edit("x", () => applyDiff(main, diff)))).toBe("DIFF_CONFLICT");
    const other = load();
    const ghost = { created: [], removed: [], changed: [{ oid: 999999n, base: "", fields: [] }] };
    expect(codeOf(() => other.edit("x", () => applyDiff(other, ghost)))).toBe("DIFF_CONFLICT");
  });

  it("createAt fora de edit lança NO_UNDO_LEVEL", () => {
    expect(codeOf(() => load().createAt(5000n, "Unit"))).toBe("NO_UNDO_LEVEL");
  });
});

describe("U-13 / RF-062: subdocumento ui do .apex.json", () => {
  it("grava, confere o SHA-256 com o ui e lê de volta; o projeto carrega igual", () => {
    const p = load();
    const ui = { activeSheet: "tasks", columnWidths: { tasks: { CT_NAME: 180 } } };
    const text = p.toNativeJson(ui);
    expect(readNativeUi(text)).toEqual(ui);
    const back = Project.fromNativeJson(text); // hash confere com o ui incluído
    expect(back.toNativeJson()).toBe(p.toNativeJson());
  });
  it("sem ui: readNativeUi devolve undefined; ui adulterado quebra o hash", () => {
    const p = load();
    expect(readNativeUi(p.toNativeJson())).toBeUndefined();
    const text = p.toNativeJson({ activeSheet: "tasks" }).replace('"activeSheet":"tasks"', '"activeSheet":"units"');
    expect(codeOf(() => Project.fromNativeJson(text))).toBe("INTEGRITY");
  });
});

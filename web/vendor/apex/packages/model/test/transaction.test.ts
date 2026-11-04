// U-31: transação dos diálogos (KernelPropertySheetBase::DoModal / DialogCommand): criação + OK = um nível; Cancel sem
// rastro; edição de fora, undo e redo recusam enquanto o diálogo está aberto; prévia (trial) desfaz só o que mexeu.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDr5 } from "../../dr5/src/index.js";
import { FIXTURES } from "../../dr5/test/helpers.js";
import { ModelError, Project } from "../src/index.js";

const load = () => Project.fromDr5(readDr5(new Uint8Array(readFileSync(join(FIXTURES, "example_simple_road_project.dr5")))));
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ModelError ? e.code : String(e);
  }
  return "ok";
};

describe("U-31: transação de diálogo", () => {
  it("criação + edição no diálogo + OK = um nível com o rótulo da criação; settle roda no commit", () => {
    const p = load();
    const n = p.size;
    let settled = 0;
    p.onSettle(() => settled++);
    p.beginLevel("New task");
    const e = p.transact(() => p.edit("inner", () => p.create("Unit", [])));
    p.transact(() => e.set("m_strName", "x"));
    expect(settled).toBe(0);
    p.commitLevel();
    expect(settled).toBe(1);
    expect(p.undoNames()).toEqual(["New task"]);
    p.undo();
    expect(p.size).toBe(n);
  });

  it("Cancel (abortLevel) desfaz tudo sem entrada no undo nem commit", () => {
    const p = load();
    const root = p.root()!;
    const name = root.name;
    const events: string[] = [];
    p.on((e) => void events.push(e.kind));
    p.beginLevel("");
    p.transact(() => {
      root.set("m_strName", "mudou");
      p.create("Unit", []);
    });
    p.abortLevel();
    expect(root.name).toBe(name);
    expect(p.canUndo).toBe(false);
    expect(events).toEqual(["pending", "abort"]); // a interface redesenha; nenhum commit
  });

  it("com o diálogo aberto, edit de fora, undo e redo recusam com TRANSACTION_OPEN; beginLevel duplo também", () => {
    const p = load();
    p.edit("antes", () => p.root()!.set("m_strName", "a"));
    p.beginLevel("");
    expect(code(() => p.edit("fora", () => undefined))).toBe("TRANSACTION_OPEN");
    expect(code(() => p.undo())).toBe("TRANSACTION_OPEN");
    expect(code(() => p.redo())).toBe("TRANSACTION_OPEN");
    expect(code(() => p.beginLevel("x"))).toBe("TRANSACTION_OPEN");
    p.abortLevel();
    expect(p.undoNames()).toEqual(["antes"]);
  });

  it("nível sem rótulo fica com o do 1.º comando de dentro; commitLevel(nome) troca", () => {
    const p = load();
    p.beginLevel("");
    p.transact(() => p.edit("Set start station", () => p.root()!.set("m_strName", "b")));
    p.commitLevel();
    expect(p.undoNames()).toEqual(["Set start station"]);
    p.beginLevel("");
    p.transact(() => p.root()!.set("m_strName", "c"));
    p.commitLevel("Edit task");
    expect(p.undoNames()).toEqual(["Set start station", "Edit task"]);
  });

  it("transact é atômico: recusa desfaz só o que ela mexeu e a transação continua", () => {
    const p = load();
    const root = p.root()!;
    p.beginLevel("");
    p.transact(() => root.set("m_strName", "primeiro"));
    expect(code(() => p.transact(() => {
      root.set("m_strName", "segundo");
      throw new Error("recusado");
    }))).toBe("Error: recusado");
    expect(root.name).toBe("primeiro");
    expect(p.inTransaction).toBe(true);
    p.commitLevel("ok");
    expect(p.undoNames()).toEqual(["ok"]);
  });

  it("trial desfaz só a prévia, dentro e fora de uma transação", () => {
    const p = load();
    const root = p.root()!;
    const n = p.size;
    expect(p.trial(() => {
      p.create("Unit", []);
      root.set("m_strName", "prévia");
      return p.size;
    })).toBe(n + 1);
    expect(p.size).toBe(n);
    expect(p.canUndo).toBe(false);
    p.beginLevel("");
    p.transact(() => root.set("m_strName", "fica"));
    p.trial(() => p.edit("x", () => root.set("m_strName", "some")));
    expect(root.name).toBe("fica");
    p.commitLevel("Edit name");
    expect(p.undoNames()).toEqual(["Edit name"]);
  });
});

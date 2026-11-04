/**
 * @apex/obra (U-61g, AL-OUT-02): o núcleo de criação do projeto (`create.ts`, antes `packages/app/src/core/create.ts`)
 * e os dados da obra `apex-obra/1` (`obra*.ts`), sem DOM, para o app, o MCP e a CLI (`apex obra export`).
 * O app continua importando pelos caminhos antigos (`core/create.ts`, `core/obra*.ts`, `mcp/values-json.ts`), que
 * reexportam daqui.
 */
export * from "./create.js";
export * from "./values.js";
export * from "./values-json.js";
export * from "./obra.js";
export * from "./obra-build.js";
export * from "./obra-check.js";
export * from "./obra-ctx.js";

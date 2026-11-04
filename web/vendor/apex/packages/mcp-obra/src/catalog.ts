/** InfraWork (vendor): só o tipo do esquema JSON de `@apex/mcp` (`catalog.ts`), usado por `obra-format.ts`. */
export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: readonly (string | number)[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minLength?: number;
  minItems?: number;
  maxItems?: number;
  additionalProperties?: boolean | JsonSchema;
  oneOf?: JsonSchema[];
  default?: unknown;
}

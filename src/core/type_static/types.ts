import type { CoreExpr } from "../ast.ts";

export type TypeStaticCtx = {
  statics: Map<string, CoreExpr>;
};

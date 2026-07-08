import type { CoreExpr } from "../ast.ts";
import type { CoreFnType } from "../ast.ts";
import type { CoreStorageClass } from "../escape.ts";
import type { CoreOwnership, CoreOwnershipHooks } from "../ownership.ts";

export type CoreAllocationReason =
  | "closure"
  | "runtime_aggregate"
  | "runtime_text"
  | "runtime_union";

export type CoreAllocationFact = {
  id: string;
  scope: string;
  storage: CoreStorageClass;
  ownership: CoreOwnership;
  reason: CoreAllocationReason;
  expression: CoreExpr["tag"];
};

export type CoreAllocationPlan = {
  facts: CoreAllocationFact[];
};

export type CoreAllocationHooks<ctx> = CoreOwnershipHooks<ctx> & {
  closure_body_ctx?: (
    expr: Extract<CoreExpr, { tag: "lam" | "rec" }>,
    ctx: ctx,
  ) => ctx | undefined;
  closure_fn_type: (expr: CoreExpr, ctx: ctx) => CoreFnType | undefined;
  is_runtime_text_concat: (
    expr: Extract<CoreExpr, { tag: "prim" }>,
    ctx: ctx,
  ) => boolean;
  is_static_value_expr: (expr: CoreExpr, ctx: ctx) => boolean;
  runtime_union_value: (expr: CoreExpr, ctx: ctx) => CoreExpr | undefined;
  scoped_static_core_call_value?: (
    expr: Extract<CoreExpr, { tag: "app" }>,
    target: Extract<CoreExpr, { tag: "lam" }>,
    ctx: ctx,
  ) => { value: CoreExpr; ctx: ctx };
  static_core_call_requires_scope?: (
    target: Extract<CoreExpr, { tag: "lam" }>,
  ) => boolean;
  static_core_call_target?: (
    expr: CoreExpr,
    ctx: ctx,
  ) => Extract<CoreExpr, { tag: "lam" }> | undefined;
  static_core_call_value: (expr: CoreExpr, ctx: ctx) => CoreExpr | undefined;
  static_struct_value: (
    expr: CoreExpr,
    ctx: ctx,
  ) => Extract<CoreExpr, { tag: "struct_value" }> | undefined;
  static_text_value: (expr: CoreExpr, ctx: ctx) => CoreExpr | undefined;
};

export type CoreAllocationState = {
  next_allocation: number;
  next_block: number;
  next_closure: number;
  next_scratch: number;
  facts: CoreAllocationFact[];
  recorded: WeakMap<CoreExpr, Set<string>>;
};

export type CoreAllocationScope = {
  name: string;
  scratch: string | undefined;
};

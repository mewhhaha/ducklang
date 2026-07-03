import type { ValType } from "../../../../op.ts";
import type { Wat } from "../../../../wat.ts";
import type { CoreExpr, CoreStmt } from "../../../ast.ts";
import type { CoreEmitCtx } from "../../../emit_ctx.ts";
import type { CoreCtx, StaticCtx } from "../../../local_collect.ts";
import type {
  RuntimeUnionInfo,
  RuntimeUnionMatchInfo,
  RuntimeUnionTarget,
} from "../../../runtime_union.ts";
import type { CoreBackendUnionStatic } from "../static.ts";
import type { CoreBackendUnion } from "../types.ts";

export type CoreBackendUnionRuntime = Omit<
  CoreBackendUnion,
  keyof CoreBackendUnionStatic
>;

export type CoreBackendUnionRuntimeInfo = {
  core_runtime_union_value: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => CoreExpr | undefined;
  runtime_union_case_info: (
    value: Extract<CoreExpr, { tag: "union_case" }>,
    ctx: StaticCtx,
  ) => RuntimeUnionInfo;
  runtime_union_match_info: (
    case_name: string,
    target: RuntimeUnionTarget,
    ctx: StaticCtx,
  ) => RuntimeUnionMatchInfo;
  runtime_union_target: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => RuntimeUnionTarget | undefined;
  runtime_union_type_expr: (
    expr: CoreExpr,
    ctx: StaticCtx,
  ) => CoreExpr | undefined;
  runtime_union_value_type: (value: CoreExpr, ctx: StaticCtx) => ValType;
  static_runtime_union_match_branch_ctx: (
    value_name: string | undefined,
    info: RuntimeUnionMatchInfo,
    ctx: StaticCtx,
  ) => StaticCtx;
};

export type CoreBackendUnionRuntimeEmit = {
  collect_runtime_union_value_locals: (
    expr: CoreExpr,
    ctx: CoreCtx,
  ) => boolean;
  emit_runtime_union_if_let_expr: (
    expr: Extract<CoreExpr, { tag: "if_let" }>,
    target: RuntimeUnionTarget,
    ctx: CoreEmitCtx,
  ) => Wat;
  emit_runtime_union_if_let_stmt: (
    stmt: Extract<CoreStmt, { tag: "if_let_stmt" }>,
    target: RuntimeUnionTarget,
    ctx: CoreEmitCtx,
  ) => Wat;
  emit_runtime_union_value: (expr: CoreExpr, ctx: CoreEmitCtx) => Wat;
};

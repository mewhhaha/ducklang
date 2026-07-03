import type { ValType } from "../../../op.ts";
import type { CoreExpr, CoreStmt } from "../../ast.ts";
import {
  expr_type as expr_type_with_hooks,
  stmt_result_type as stmt_result_type_with_hooks,
} from "../../expr_type.ts";
import type { StaticCtx } from "../../local_collect.ts";
import {
  type CoreBackendExprType,
  type CoreBackendExprTypeApi,
} from "./expr_type/types.ts";
import { create_core_backend_expr_type_hooks } from "./expr_type/hooks.ts";
import { core_typed_prim as core_typed_prim_with_expr_type } from "./expr_type/prim.ts";

export type {
  CoreBackendExprType,
  CoreBackendExprTypeApi,
} from "./expr_type/types.ts";

export function create_core_backend_expr_type(
  api: CoreBackendExprTypeApi,
): CoreBackendExprType {
  const core_expr_type_hooks = create_core_backend_expr_type_hooks(
    api,
    core_typed_prim,
  );

  function stmt_result_type(
    stmt: CoreStmt,
    ctx: StaticCtx,
  ): ValType {
    return stmt_result_type_with_hooks(stmt, ctx, core_expr_type_hooks);
  }

  function expr_type(
    expr: CoreExpr,
    ctx: StaticCtx,
  ): ValType {
    return expr_type_with_hooks(expr, ctx, core_expr_type_hooks);
  }

  function core_typed_prim(
    expr: Extract<CoreExpr, { tag: "prim" }>,
    ctx: StaticCtx,
  ) {
    return core_typed_prim_with_expr_type(expr, ctx, expr_type);
  }

  return {
    core_typed_prim,
    expr_type,
    stmt_result_type,
  };
}

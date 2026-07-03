import type { ValType } from "../../../../../op.ts";
import type { CoreExpr } from "../../../../ast.ts";
import type { StaticCtx } from "../../../../local_collect.ts";
import {
  core_runtime_union_value as core_runtime_union_value_with_hooks,
  runtime_union_case_info as runtime_union_case_info_with_hooks,
  runtime_union_target as runtime_union_target_with_hooks,
  runtime_union_value_type as runtime_union_value_type_with_hooks,
  type RuntimeUnionHooks,
  type RuntimeUnionInfo,
  type RuntimeUnionTarget,
} from "../../../../runtime_union.ts";
import type { CoreBackendUnionRuntimeInfo } from "../types.ts";

export type CoreBackendUnionRuntimeQuery = Pick<
  CoreBackendUnionRuntimeInfo,
  | "core_runtime_union_value"
  | "runtime_union_case_info"
  | "runtime_union_target"
  | "runtime_union_value_type"
>;

export function create_core_backend_union_runtime_query(
  hooks: () => RuntimeUnionHooks<StaticCtx>,
): CoreBackendUnionRuntimeQuery {
  function core_runtime_union_value(
    expr: CoreExpr,
    ctx: StaticCtx,
  ): CoreExpr | undefined {
    return core_runtime_union_value_with_hooks(
      expr,
      ctx,
      hooks(),
    );
  }

  function runtime_union_target(
    expr: CoreExpr,
    ctx: StaticCtx,
  ): RuntimeUnionTarget | undefined {
    return runtime_union_target_with_hooks(expr, ctx, hooks());
  }

  function runtime_union_value_type(
    value: CoreExpr,
    ctx: StaticCtx,
  ): ValType {
    return runtime_union_value_type_with_hooks(
      value,
      ctx,
      hooks(),
    );
  }

  function runtime_union_case_info(
    value: Extract<CoreExpr, { tag: "union_case" }>,
    ctx: StaticCtx,
  ): RuntimeUnionInfo {
    return runtime_union_case_info_with_hooks(
      value,
      ctx,
      hooks(),
    );
  }

  return {
    core_runtime_union_value,
    runtime_union_case_info,
    runtime_union_target,
    runtime_union_value_type,
  };
}

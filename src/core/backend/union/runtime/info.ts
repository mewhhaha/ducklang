import type { CoreExpr } from "../../../ast.ts";
import type { StaticCtx } from "../../../local_collect.ts";
import {
  runtime_union_type_expr as runtime_union_type_expr_with_hooks,
  type RuntimeUnionHooks,
} from "../../../runtime_union.ts";
import type { CoreBackendUnionStatic } from "../static.ts";
import type { CoreBackendUnionApi } from "../types.ts";
import { create_core_backend_union_runtime_hooks } from "./info/hooks.ts";
import { create_core_backend_union_runtime_match_info } from "./info/match.ts";
import { create_core_backend_union_runtime_query } from "./info/query.ts";
import type { CoreBackendUnionRuntimeInfo } from "./types.ts";

export function create_core_backend_union_runtime_info(
  api: CoreBackendUnionApi,
  static_union: CoreBackendUnionStatic,
): CoreBackendUnionRuntimeInfo {
  let runtime_union_hooks: RuntimeUnionHooks<StaticCtx>;

  function runtime_union_type_expr(
    expr: CoreExpr,
    ctx: StaticCtx,
  ): CoreExpr | undefined {
    return runtime_union_type_expr_with_hooks(
      expr,
      ctx,
      runtime_union_hooks,
    );
  }

  runtime_union_hooks = create_core_backend_union_runtime_hooks(
    api,
    static_union,
    runtime_union_type_expr,
  );
  const query = create_core_backend_union_runtime_query(
    () => runtime_union_hooks,
  );
  const match = create_core_backend_union_runtime_match_info();

  return {
    ...query,
    ...match,
    runtime_union_type_expr,
  };
}

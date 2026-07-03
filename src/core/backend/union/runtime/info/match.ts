import type { StaticCtx } from "../../../../local_collect.ts";
import {
  runtime_union_match_info as runtime_union_match_info_without_hooks,
  type RuntimeUnionMatchInfo,
  type RuntimeUnionTarget,
} from "../../../../runtime_union.ts";
import {
  static_runtime_union_match_branch_ctx
    as static_runtime_union_match_branch_ctx_without_hooks,
} from "../../../../runtime_union_match.ts";
import type { CoreBackendUnionRuntimeInfo } from "../types.ts";

export type CoreBackendUnionRuntimeMatch = Pick<
  CoreBackendUnionRuntimeInfo,
  | "runtime_union_match_info"
  | "static_runtime_union_match_branch_ctx"
>;

export function create_core_backend_union_runtime_match_info(): CoreBackendUnionRuntimeMatch {
  function runtime_union_match_info(
    case_name: string,
    target: RuntimeUnionTarget,
    ctx: StaticCtx,
  ): RuntimeUnionMatchInfo {
    return runtime_union_match_info_without_hooks(case_name, target, ctx);
  }

  function static_runtime_union_match_branch_ctx(
    value_name: string | undefined,
    info: RuntimeUnionMatchInfo,
    ctx: StaticCtx,
  ): StaticCtx {
    return static_runtime_union_match_branch_ctx_without_hooks(
      value_name,
      info,
      ctx,
    );
  }

  return {
    runtime_union_match_info,
    static_runtime_union_match_branch_ctx,
  };
}

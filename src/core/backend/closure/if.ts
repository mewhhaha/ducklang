import type { Wat } from "../../../wat.ts";
import type { CoreExpr, CoreFnType } from "../../ast.ts";
import type { CoreBackendClosure, CoreBackendClosureApi } from "./types.ts";
import type { CoreBackendClosureEmit } from "./emit.ts";
import type { CoreBackendClosureType } from "./type.ts";
import {
  type CoreClosureIfEmitHooks,
  type CoreClosureIfLetEmitHooks,
  emit_core_closure_if_expr as emit_core_closure_if_expr_with_hooks,
  emit_core_closure_if_let_expr as emit_core_closure_if_let_expr_with_hooks,
} from "../../closure_if_emit.ts";
import type { CoreEmitCtx } from "../../emit_ctx.ts";
import {
  bind_core_if_let_payload as bind_core_if_let_payload_with_hooks,
} from "../../if_let_payload.ts";
import { runtime_aggregate_type_expr } from "../../runtime_aggregate.ts";

export type CoreBackendClosureIf = Pick<
  CoreBackendClosure,
  "emit_core_closure_if_expr" | "emit_core_closure_if_let_expr"
>;

export function create_core_backend_closure_if(
  api: CoreBackendClosureApi,
  closure_type: CoreBackendClosureType,
  closure_emit: CoreBackendClosureEmit,
): CoreBackendClosureIf {
  const closure_if_emit_hooks = {
    closure_fn_type_with_expected: closure_type.closure_fn_type_with_expected,
    emit_expr: api.emit_expr,
    emit_runtime_closure_with_type: closure_emit.emit_runtime_closure_with_type,
    emit_stmt: api.emit_stmt,
    expr_type: api.expr_type,
  } satisfies CoreClosureIfEmitHooks<CoreEmitCtx>;
  const closure_if_let_emit_hooks = {
    ...closure_if_emit_hooks,
    bind_payload,
    dynamic_union_if: api.dynamic_union_if,
    match_branch_ctx: api.match_branch_ctx,
    runtime_union_match_info: api.runtime_union_match_info,
    runtime_union_target: api.runtime_union_target,
    static_union_case: api.static_union_case,
  } satisfies CoreClosureIfLetEmitHooks<CoreEmitCtx>;

  function bind_payload(
    value_name: string | undefined,
    union_case: Extract<CoreExpr, { tag: "union_case" }>,
    ctx: CoreEmitCtx,
  ): { setup: Wat; ctx: CoreEmitCtx } {
    return bind_core_if_let_payload_with_hooks(
      value_name,
      union_case,
      ctx,
      {
        branch_payload_ctx: api.branch_payload_ctx,
        clear_core_local_facts: api.clear_core_local_facts,
        core_expr_is_text: api.core_expr_is_text,
        emit_expr: api.emit_expr,
        expr_type: api.expr_type,
        runtime_aggregate_type_expr: (value, value_ctx) =>
          runtime_aggregate_type_expr(value, value_ctx, {
            check_closure_call_args: closure_type.check_closure_call_args,
            closure_fn_type: closure_type.closure_fn_type,
          }),
        runtime_union_type_expr: api.runtime_union_type_expr,
        static_struct_value: api.static_struct_value,
      },
    );
  }

  function emit_core_closure_if_expr(
    expr: Extract<CoreExpr, { tag: "if" }>,
    fn_type: CoreFnType,
    ctx: CoreEmitCtx,
  ): Wat {
    return emit_core_closure_if_expr_with_hooks(
      expr,
      fn_type,
      ctx,
      closure_if_emit_hooks,
    );
  }

  function emit_core_closure_if_let_expr(
    expr: Extract<CoreExpr, { tag: "if_let" }>,
    fn_type: CoreFnType,
    ctx: CoreEmitCtx,
  ): Wat {
    return emit_core_closure_if_let_expr_with_hooks(
      expr,
      fn_type,
      ctx,
      closure_if_let_emit_hooks,
    );
  }

  return {
    emit_core_closure_if_expr,
    emit_core_closure_if_let_expr,
  };
}

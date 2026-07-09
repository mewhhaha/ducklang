import type { ValType } from "../../../../op.ts";
import type { CoreExpr, CoreField, CoreStmt } from "../../../ast.ts";
import type { DynamicUnionIf } from "../../../if_let.ts";
import type { CoreCtx, StaticCtx } from "../../../local_collect.ts";
import { static_type_value } from "../../../type_static.ts";
import type { CoreBackendExprType } from "../../analysis/expr_type.ts";
import { create_core_backend_expr_type } from "../../analysis/expr_type.ts";
import type { CoreBackendLocalFacts } from "../../analysis/local_facts.ts";
import type { CoreBackendGraphDeps } from "../../graph_deps.ts";

export function create_core_backend_graph_expr_type(
  deps: CoreBackendGraphDeps,
  local_facts: CoreBackendLocalFacts,
): CoreBackendExprType {
  return create_core_backend_expr_type({
    app_type: (expr: Extract<CoreExpr, { tag: "app" }>, ctx: StaticCtx) =>
      deps.app().app_type(expr, ctx),
    bind_core_if_let_payload_fact: (
      value_name: string | undefined,
      union_case: Extract<CoreExpr, { tag: "union_case" }>,
      ctx: StaticCtx,
    ) =>
      deps.control_flow().bind_core_if_let_payload_fact(
        value_name,
        union_case,
        ctx,
      ),
    bind_dynamic_if_let_payload: (
      case_name: string,
      value_name: string | undefined,
      target: DynamicUnionIf,
      ctx: StaticCtx,
    ) =>
      deps.union().bind_dynamic_if_let_payload(
        case_name,
        value_name,
        target,
        ctx,
      ),
    check_core_text_concat_operand_visibility: (
      expr: Extract<CoreExpr, { tag: "prim" }>,
      ctx: StaticCtx,
    ) => deps.text().check_core_text_concat_operand_visibility(expr, ctx),
    check_closure_call_args: (
      expr: Extract<CoreExpr, { tag: "app" }>,
      fn_type,
      ctx: StaticCtx,
    ) => deps.closure().check_closure_call_args(expr, fn_type, ctx),
    clear_optional_core_union_local:
      local_facts.clear_optional_core_union_local,
    closure_fn_type: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.closure().closure_fn_type(expr, ctx),
    collect_stmt_locals: (stmt: CoreStmt, ctx: CoreCtx) =>
      deps.local_collect().collect_stmt_locals(stmt, ctx),
    core_expr_is_text: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.text().core_expr_is_text(expr, ctx),
    core_runtime_text_concat_operands: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.text().core_runtime_text_concat_operands(expr, ctx),
    core_runtime_text_eq_operands: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.text().core_runtime_text_eq_operands(expr, ctx),
    core_runtime_union_value: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.union().core_runtime_union_value(expr, ctx),
    dynamic_union_if: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.union().dynamic_union_if(expr, ctx),
    runtime_union_match_info: (
      case_name: string,
      target,
      ctx: StaticCtx,
    ) => deps.union().runtime_union_match_info(case_name, target, ctx),
    runtime_union_target: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.union().runtime_union_target(expr, ctx),
    runtime_union_value_type: (value: CoreExpr, ctx: StaticCtx): ValType =>
      deps.union().runtime_union_value_type(value, ctx),
    static_collection_fields: (
      expr: CoreExpr,
      ctx: StaticCtx,
    ): CoreField[] | undefined =>
      deps.struct().static_collection_fields(
        expr,
        ctx,
      ),
    static_core_call_requires_scope: (target) =>
      deps.static_call().static_core_call_requires_scope(target),
    static_core_call_target: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.static_call().static_core_call_target(expr, ctx),
    static_core_call_value: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.static_call().static_core_call_value(expr, ctx),
    static_runtime_union_match_branch_ctx: (
      value_name: string | undefined,
      info,
      ctx: StaticCtx,
    ) =>
      deps.union().static_runtime_union_match_branch_ctx(
        value_name,
        info,
        ctx,
      ),
    static_struct_value: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.struct().static_struct_value(expr, ctx),
    static_text_byte_index_expr: (
      expr: Extract<CoreExpr, { tag: "index" }>,
      ctx: StaticCtx,
    ) => deps.text().static_text_byte_index_expr(expr, ctx),
    static_text_value: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.text().static_text_value(expr, ctx),
    static_type_value,
    static_union_case: (expr: CoreExpr, ctx: StaticCtx) =>
      deps.union().static_union_case(expr, ctx),
  });
}

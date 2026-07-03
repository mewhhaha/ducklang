import { expect } from "../../../expect.ts";
import type { CoreExpr } from "../../ast.ts";
import type { CoreBackendText, CoreBackendTextApi } from "./types.ts";
import type { StaticCtx } from "../../local_collect.ts";
import { text_byte_index_expr } from "../../text_index.ts";
import {
  check_core_text_concat_operand_visibility
    as check_core_text_concat_operand_visibility_with_hooks,
  static_text_if_branches as static_text_if_branches_with_hooks,
  static_text_length_expr as static_text_length_expr_with_hooks,
  static_text_value as static_text_value_with_hooks,
  type StaticTextHooks,
} from "../../text_static.ts";

export type CoreBackendTextStatic = Pick<
  CoreBackendText,
  | "check_core_text_concat_operand_visibility"
  | "static_text_byte_index_expr"
  | "static_text_if_branches"
  | "static_text_length_expr"
  | "static_text_value"
  | "text_byte_index_expr"
>;

export function create_core_backend_text_static(
  api: CoreBackendTextApi,
): CoreBackendTextStatic {
  const static_text_hooks = {
    static_collection_fields: api.static_collection_fields,
    expr_type: api.expr_type,
    static_union_case: api.static_union_case,
    dynamic_union_if: api.dynamic_union_if,
  } satisfies StaticTextHooks;

  function static_text_value(
    expr: CoreExpr,
    ctx: StaticCtx,
  ): CoreExpr | undefined {
    return static_text_value_with_hooks(expr, ctx, static_text_hooks);
  }

  function static_text_if_branches(
    expr: Extract<CoreExpr, { tag: "if" }>,
    ctx: StaticCtx,
  ):
    | {
      then_text: CoreExpr;
      else_text: CoreExpr;
    }
    | undefined {
    return static_text_if_branches_with_hooks(expr, ctx, static_text_hooks);
  }

  function static_text_length_expr(
    expr: CoreExpr,
    ctx: StaticCtx,
  ): CoreExpr | undefined {
    return static_text_length_expr_with_hooks(expr, ctx, static_text_hooks);
  }

  function check_core_text_concat_operand_visibility(
    expr: Extract<CoreExpr, { tag: "prim" }>,
    ctx: StaticCtx,
  ): void {
    check_core_text_concat_operand_visibility_with_hooks(
      expr,
      ctx,
      static_text_hooks,
    );
  }

  function static_text_byte_index_expr(
    expr: Extract<CoreExpr, { tag: "index" }>,
    ctx: StaticCtx,
  ): CoreExpr | undefined {
    const text = static_text_value(expr.object, ctx);

    if (!text) {
      return undefined;
    }

    const index_type = api.expr_type(expr.index, ctx);
    expect(index_type === "i32", "Core text byte index must be i32");
    return text_byte_index_expr(text, expr.index);
  }

  return {
    check_core_text_concat_operand_visibility,
    static_text_byte_index_expr,
    static_text_if_branches,
    text_byte_index_expr,
    static_text_length_expr,
    static_text_value,
  };
}

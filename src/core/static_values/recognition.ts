import type { CoreExpr } from "../ast.ts";
import { static_block_result } from "../type_static.ts";
import { is_scratch_free_static_value_expr } from "./scratch_free.ts";
import type { StaticValueRecognitionHooks } from "./types.ts";

type StaticValueAliasCtx = {
  statics: Map<string, CoreExpr>;
};

export function is_static_value_expr<ctx extends StaticValueAliasCtx>(
  value: CoreExpr,
  ctx: ctx,
  hooks: StaticValueRecognitionHooks<ctx>,
): boolean {
  const inlined = hooks.static_core_call_value(value, ctx);

  if (inlined) {
    return is_static_value_expr(inlined, ctx, hooks);
  }

  if (hooks.static_text_value(value, ctx)) {
    return true;
  }

  if (hooks.static_union_case(value, ctx)) {
    return true;
  }

  if (hooks.dynamic_union_if(value, ctx)) {
    return true;
  }

  if (hooks.static_struct_value(value, ctx)) {
    return true;
  }

  if (value.tag === "var") {
    const static_value = ctx.statics.get(value.name);

    if (static_value) {
      return is_static_value_expr(static_value, ctx, hooks);
    }
  }

  if (value.tag === "text") {
    return true;
  }

  if (value.tag === "struct_value") {
    return true;
  }

  if (value.tag === "union_case") {
    return true;
  }

  if (value.tag === "if") {
    return is_static_value_expr(value.then_branch, ctx, hooks) &&
      is_static_value_expr(value.else_branch, ctx, hooks);
  }

  if (value.tag === "struct_update") {
    return true;
  }

  if (value.tag === "scratch") {
    return is_static_value_expr(value.body, ctx, hooks) &&
      is_scratch_free_static_value_expr(value.body, ctx, hooks);
  }

  const block_value = static_block_result(value);

  if (block_value) {
    return is_static_value_expr(block_value, ctx, hooks);
  }

  return false;
}

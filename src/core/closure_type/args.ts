import { expect } from "../../expect.ts";
import type { CoreExpr, CoreFnType } from "../ast.ts";
import type { CoreClosureTypeCtx, CoreClosureTypeHooks } from "./types.ts";

export function check_closure_call_args(
  expr: Extract<CoreExpr, { tag: "app" }>,
  fn_type: CoreFnType,
  ctx: CoreClosureTypeCtx,
  hooks: CoreClosureTypeHooks,
): void {
  if (expr.args.length !== fn_type.params.length) {
    throw new Error(
      "Core closure call expected " + fn_type.params.length.toString() +
        " arguments, got " + expr.args.length.toString(),
    );
  }

  for (let index = 0; index < expr.args.length; index += 1) {
    const arg = expr.args[index];
    const expected = fn_type.params[index];
    const expected_text = fn_type.param_texts[index];
    expect(arg, "Missing core closure call argument " + index.toString());
    expect(expected, "Missing core closure call parameter " + index.toString());
    expect(
      expected_text !== undefined,
      "Missing core closure call parameter text fact " + index.toString(),
    );
    const actual = hooks.expr_type(arg, ctx);
    expect(
      actual === expected,
      "Core closure call argument " + index.toString() + " expects " +
        expected + ", got " + actual,
    );

    if (expected_text) {
      expect(
        hooks.core_expr_is_text(arg, ctx),
        "Core closure call argument " + index.toString() +
          " expects Text",
      );
    } else if (expected === "i32" && hooks.core_expr_is_text(arg, ctx)) {
      throw new Error(
        "Core closure call argument " + index.toString() +
          " expects i32, got Text",
      );
    }
  }
}

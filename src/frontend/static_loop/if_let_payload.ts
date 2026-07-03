import { expect } from "../../expect.ts";
import type { Env, FrontExpr, Stmt } from "../ast.ts";
import { capture_expr } from "../capture.ts";
import { bind_loop_static_value } from "./binding.ts";
import type { StaticLoopHooks } from "./types.ts";

export function bind_static_if_let_payload(
  stmt: Extract<Stmt, { tag: "if_let_stmt" }>,
  target: { expr: Extract<FrontExpr, { tag: "union_case" }>; env: Env },
  env: Env,
  hooks: StaticLoopHooks,
): void {
  expect(stmt.value_name, "Missing static if let payload name");
  const value = target.expr.value;

  if (!value) {
    throw new Error("Union case has no payload: " + stmt.case_name);
  }

  let value_expr = capture_expr(value, target.env);
  const static_i32 = hooks.resolve_static_i32_expr(value, target.env);

  if (static_i32 !== undefined) {
    value_expr = { tag: "num", type: "i32", value: static_i32 };
  }

  bind_loop_static_value(env, stmt.value_name, value_expr);
}

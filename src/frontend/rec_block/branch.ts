import type { Env, FrontType, Stmt } from "../ast.ts";
import { dynamic_if_let_ic_route } from "../diagnostic.ts";
import { infer_rec_expr } from "../rec_infer.ts";
import type { StaticRecHooks } from "../rec_hooks.ts";
import type { StaticRecBlockLowerer, StaticRecResult } from "../rec_result.ts";
import type { StaticRecExpectedResultLowerer } from "./types.ts";

export function lower_static_rec_if_stmt(
  stmt: Extract<Stmt, { tag: "if_stmt" }>,
  rest: Stmt[],
  local: Env,
  hooks: StaticRecHooks,
  block_lowerer: StaticRecBlockLowerer,
  lower_rec_result_expr_with_expected_type: StaticRecExpectedResultLowerer,
  expected_type: FrontType | undefined,
): StaticRecResult | undefined {
  const cond = hooks.resolve_static_i32_expr(stmt.cond, local);

  if (cond === undefined) {
    return {
      tag: "done",
      value: lower_rec_result_expr_with_expected_type(
        {
          tag: "if",
          cond: stmt.cond,
          then_branch: {
            tag: "block",
            statements: [...stmt.body, ...rest],
          },
          else_branch: {
            tag: "block",
            statements: rest,
          },
        },
        local,
        hooks,
        block_lowerer,
        expected_type,
      ),
    };
  }

  if (cond !== 0) {
    return block_lowerer(
      [...stmt.body, ...rest],
      hooks.clone_env(local),
      hooks,
      expected_type,
    );
  }

  return undefined;
}

export function lower_static_rec_if_let_stmt(
  stmt: Extract<Stmt, { tag: "if_let_stmt" }>,
  rest: Stmt[],
  local: Env,
  hooks: StaticRecHooks,
  block_lowerer: StaticRecBlockLowerer,
  lower_rec_result_expr_with_expected_type: StaticRecExpectedResultLowerer,
  expected_type: FrontType | undefined,
): StaticRecResult | undefined {
  const target = hooks.resolve_union_value(stmt.target, local);

  if (!target) {
    const target_type = infer_rec_expr(stmt.target, local, hooks);

    if (target_type.tag === "union_value") {
      return {
        tag: "done",
        value: lower_rec_result_expr_with_expected_type(
          {
            tag: "if_let",
            case_name: stmt.case_name,
            value_name: stmt.value_name,
            target: stmt.target,
            then_branch: {
              tag: "block",
              statements: [...stmt.body, ...rest],
            },
            else_branch: {
              tag: "block",
              statements: rest,
            },
          },
          local,
          hooks,
          block_lowerer,
          expected_type,
        ),
      };
    }

    throw new Error(dynamic_if_let_ic_route);
  }

  if (target.expr.name === stmt.case_name) {
    let body = stmt.body;

    if (stmt.value_name) {
      const value = target.expr.value;

      if (!value) {
        throw new Error("Union case has no payload: " + stmt.case_name);
      }

      body = [
        {
          tag: "bind",
          kind: "let",
          name: stmt.value_name,
          is_linear: false,
          annotation: undefined,
          value: hooks.capture_expr(value, target.env),
        },
        ...stmt.body,
      ];
    }

    return block_lowerer(
      [...body, ...rest],
      hooks.clone_env(local),
      hooks,
      expected_type,
    );
  }

  return undefined;
}

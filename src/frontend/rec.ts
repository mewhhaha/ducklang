import { expect } from "../expect.ts";
import type { Ic as IcNode } from "../ic.ts";
import type { Env, FrontExpr, FrontType, Stmt } from "./ast.ts";
import { structured_core_route } from "./diagnostic.ts";
import { infer_rec_expr } from "./rec_infer.ts";
import { is_rec_call } from "./rec_validate.ts";
import type { StaticRecHooks } from "./rec_hooks.ts";
import { bind_rec_args, resolve_rec_target } from "./rec_bind.ts";
import { lower_rec_result_expr, type StaticRecResult } from "./rec_result.ts";

export { validate_rec_tail } from "./rec_validate.ts";

export function infer_static_rec_app_type(
  expr: Extract<FrontExpr, { tag: "app" }>,
  env: Env,
  hooks: StaticRecHooks,
): FrontType | undefined {
  const target = resolve_rec_target(expr.func, env, hooks);

  if (!target) {
    return undefined;
  }

  const rec = target.expr;

  if (expr.args.length !== rec.params.length) {
    throw new Error(
      "rec expected " + rec.params.length.toString() + " arguments, got " +
        expr.args.length.toString(),
    );
  }

  const args = expr.args.map((arg) => hooks.capture_expr(arg, env));
  const local = hooks.clone_env(target.env);
  bind_rec_args(rec, args, local, hooks);
  return infer_rec_expr(rec.body, local, hooks);
}

export function lower_static_rec_app(
  expr: Extract<FrontExpr, { tag: "app" }>,
  env: Env,
  hooks: StaticRecHooks,
): IcNode | undefined {
  const target = resolve_rec_target(expr.func, env, hooks);

  if (!target) {
    return undefined;
  }

  const rec = target.expr;

  if (expr.args.length !== rec.params.length) {
    throw new Error(
      "rec expected " + rec.params.length.toString() + " arguments, got " +
        expr.args.length.toString(),
    );
  }

  let args = expr.args.map((arg) => hooks.capture_expr(arg, env));

  for (let step = 0; step < 10000; step += 1) {
    const local = hooks.clone_env(target.env);
    bind_rec_args(rec, args, local, hooks);
    const result = lower_static_rec_expr(rec.body, local, hooks);

    if (!result) {
      throw new Error(
        "Cannot lower rec to Ic frontend yet" + structured_core_route,
      );
    }

    if (result.tag === "done") {
      return result.value;
    }

    args = result.args;
  }

  throw new Error("rec static lowering exceeded 10000 steps");
}

function lower_static_rec_expr(
  expr: FrontExpr,
  env: Env,
  hooks: StaticRecHooks,
): StaticRecResult | undefined {
  if (expr.tag === "captured") {
    return lower_static_rec_expr(expr.expr, expr.env, hooks);
  }

  if (expr.tag === "block") {
    return lower_static_rec_block(expr.statements, env, hooks);
  }

  if (expr.tag === "if") {
    const cond = hooks.resolve_static_i32_expr(expr.cond, env);

    if (cond === undefined) {
      return {
        tag: "done",
        value: lower_rec_result_expr(
          expr,
          env,
          hooks,
          lower_static_rec_block,
        ),
      };
    }

    if (cond !== 0) {
      return lower_static_rec_expr(expr.then_branch, env, hooks);
    }

    return lower_static_rec_expr(expr.else_branch, env, hooks);
  }

  if (is_rec_call(expr)) {
    expect(expr.tag === "app", "Expected rec call");
    return {
      tag: "call",
      args: expr.args.map((arg) => hooks.capture_expr(arg, env)),
    };
  }

  return {
    tag: "done",
    value: lower_rec_result_expr(expr, env, hooks, lower_static_rec_block),
  };
}

function lower_static_rec_block(
  stmts: Stmt[],
  env: Env,
  hooks: StaticRecHooks,
): StaticRecResult | undefined {
  const local = hooks.clone_env(env);

  for (let index = 0; index < stmts.length; index += 1) {
    const stmt = stmts[index];
    expect(stmt, "Missing rec body statement " + index);
    const is_final = index + 1 >= stmts.length;

    if (stmt.tag === "expr") {
      if (is_final) {
        return lower_static_rec_expr(stmt.expr, local, hooks);
      }

      lower_rec_result_expr(stmt.expr, local, hooks, lower_static_rec_block);
    } else if (stmt.tag === "return") {
      return lower_static_rec_expr(stmt.value, local, hooks);
    } else if (stmt.tag === "bind") {
      let value = stmt.value;

      if (stmt.kind === "const") {
        value = hooks.prepare_const_value(value, local);
        hooks.push_binding(local, {
          name: stmt.name,
          ic_name: stmt.name,
          type: hooks.infer_expr(value, local),
          is_const: true,
          is_linear: stmt.is_linear,
          value,
          value_env: undefined,
        });
      } else {
        value = hooks.prepare_runtime_value(value, local);
        let value_type = hooks.infer_expr(value, local);

        if (stmt.annotation) {
          const annotated = hooks.apply_runtime_binding_annotation(
            stmt.annotation,
            value,
            local,
          );
          value = annotated.value;
          value_type = annotated.type;
        }

        hooks.push_binding(local, {
          name: stmt.name,
          ic_name: hooks.fresh(local, stmt.name),
          type: value_type,
          is_const: false,
          is_linear: stmt.is_linear,
          value,
          value_env: hooks.clone_env(local),
        });
      }
    } else if (stmt.tag === "assign") {
      const previous = hooks.lookup(local, stmt.name);
      expect(previous, "Cannot assign unbound name: " + stmt.name);
      const value = hooks.prepare_runtime_value(stmt.value, local);
      let value_type = hooks.infer_expr(value, local);

      if (stmt.mode === "same" && !hooks.same_type(previous.type, value_type)) {
        throw new Error("Assignment changes type for " + stmt.name);
      }

      value_type = hooks.assignment_type(
        previous.type,
        value_type,
        stmt.mode,
      );

      hooks.push_binding(local, {
        name: stmt.name,
        ic_name: hooks.fresh(local, stmt.name),
        type: value_type,
        is_const: false,
        is_linear: previous.is_linear,
        value,
        value_env: hooks.clone_env(local),
      });
    } else if (stmt.tag === "index_assign") {
      const value = hooks.apply_index_assignment(stmt, local);
      hooks.push_binding(local, {
        name: stmt.name,
        ic_name: hooks.fresh(local, stmt.name),
        type: hooks.infer_expr(value, local),
        is_const: false,
        is_linear: false,
        value,
        value_env: hooks.clone_env(local),
      });
    } else if (stmt.tag === "for_range") {
      const expanded = hooks.expand_for_range(stmt, local);
      const rest = stmts.slice(index + 1);
      return lower_static_rec_block([...expanded, ...rest], local, hooks);
    } else if (stmt.tag === "for_collection") {
      const expanded = hooks.expand_for_collection(stmt, local);
      const rest = stmts.slice(index + 1);
      return lower_static_rec_block([...expanded, ...rest], local, hooks);
    } else if (stmt.tag === "if_stmt") {
      const cond = hooks.resolve_static_i32_expr(stmt.cond, local);
      const rest = stmts.slice(index + 1);

      if (cond === undefined) {
        return {
          tag: "done",
          value: lower_rec_result_expr(
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
            lower_static_rec_block,
          ),
        };
      }

      if (cond !== 0) {
        return lower_static_rec_block(
          [...stmt.body, ...rest],
          hooks.clone_env(local),
          hooks,
        );
      }
    } else if (stmt.tag === "if_let_stmt") {
      const target = hooks.resolve_union_value(stmt.target, local);
      const rest = stmts.slice(index + 1);

      if (!target) {
        const target_type = infer_rec_expr(stmt.target, local, hooks);

        if (target_type.tag === "union_value") {
          return {
            tag: "done",
            value: lower_rec_result_expr(
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
              lower_static_rec_block,
            ),
          };
        }

        throw new Error(
          "Cannot lower dynamic if let to Ic frontend yet" +
            structured_core_route,
        );
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

        return lower_static_rec_block(
          [...body, ...rest],
          hooks.clone_env(local),
          hooks,
        );
      }
    } else if (stmt.tag === "type_check") {
      hooks.check_type_pattern(stmt.pattern, stmt.target, local);
    } else if (stmt.tag === "break" || stmt.tag === "continue") {
      throw new Error("Cannot lower rec " + stmt.tag + " body yet");
    } else if (stmt.tag === "import") {
      throw new Error(
        "Cannot lower unresolved import; use Source.load or Source.compile_file",
      );
    } else if (stmt.tag === "host_import") {
      throw new Error(
        "Cannot lower host import through static rec; " +
          "use Source.core, Source.mod, or Source.wat",
      );
    } else {
      throw new Error("Cannot lower rec " + stmt.tag + " body yet");
    }
  }

  return undefined;
}

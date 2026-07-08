import type { Env, FrontExpr, Stmt } from "../ast.ts";
import { clone_env } from "../env.ts";
import { record_static_loop_statement } from "./binding.ts";
import {
  contains_loop_control,
  dynamic_conditional_loop_control_body,
  type DynamicLoopState,
  guard_loop_step,
  loop_break_statements,
  loop_continue_statements,
} from "./dynamic_control.ts";
import {
  dynamic_loop_control_assignment,
  dynamic_loop_control_binding,
} from "./expand_dynamic_binding.ts";
import { bind_static_if_let_payload } from "./if_let_payload.ts";
import type { StaticLoopBodyExpanders } from "./body.ts";
import type { ExpandedLoopBody, StaticLoopHooks } from "./types.ts";

export function expand_dynamic_loop_control_body(
  stmts: Stmt[],
  env: Env,
  hooks: StaticLoopHooks,
  state: DynamicLoopState,
  expanders: StaticLoopBodyExpanders,
): ExpandedLoopBody {
  const statements: Stmt[] = [];

  for (const stmt of stmts) {
    if (stmt.tag === "break") {
      statements.push(guard_loop_step(state, loop_break_statements(state)));
      return { statements, control: "none" };
    }

    if (stmt.tag === "continue") {
      statements.push(guard_loop_step(state, loop_continue_statements(state)));
      return { statements, control: "none" };
    }

    if (stmt.tag === "return") {
      statements.push(guard_loop_step(state, [stmt]));
      return { statements, control: "none" };
    }

    if (stmt.tag === "bind") {
      const binding = dynamic_loop_control_binding(stmt, env, hooks, state);
      statements.push(binding);
      record_static_loop_statement(binding, env);
      continue;
    }

    if (stmt.tag === "assign") {
      const assignment = dynamic_loop_control_assignment(
        stmt,
        env,
        hooks,
        state,
      );

      if (assignment) {
        statements.push(assignment);
        record_static_loop_statement(assignment, env);
        continue;
      }
    }

    if (stmt.tag === "for_range") {
      const body = expanders.expand_for_range_body(stmt, env, hooks);

      if (body.statements.length > 0) {
        statements.push(guard_loop_step(state, body.statements));
      }

      continue;
    }

    if (stmt.tag === "for_collection") {
      const body = expanders.expand_for_collection_body(stmt, env, hooks);

      if (body.statements.length > 0) {
        statements.push(guard_loop_step(state, body.statements));
      }

      continue;
    }

    if (stmt.tag === "if_stmt") {
      const cond = hooks.resolve_static_i32_expr(stmt.cond, env);

      if (cond !== undefined) {
        if (cond !== 0) {
          const body = expand_dynamic_loop_control_body(
            stmt.body,
            env,
            hooks,
            state,
            expanders,
          );
          statements.push(...body.statements);
        }

        continue;
      }

      const conditional_body = dynamic_conditional_loop_control_body(
        stmt.body,
        state,
      );

      if (conditional_body) {
        statements.push(
          guard_loop_step(state, [{
            tag: "if_stmt",
            cond: stmt.cond,
            body: conditional_body,
          }]),
        );
        continue;
      }

      if (contains_loop_control(stmt.body)) {
        const body = expand_dynamic_loop_control_body(
          stmt.body,
          env,
          hooks,
          state,
          expanders,
        );
        statements.push(
          guard_loop_step(state, [{
            tag: "if_stmt",
            cond: stmt.cond,
            body: body.statements,
          }]),
        );
        continue;
      }

      statements.push(guard_loop_step(state, [stmt]));
      continue;
    }

    if (stmt.tag === "if_let_stmt") {
      const target = hooks.resolve_union_value(stmt.target, env);

      if (target) {
        if (target.expr.name !== stmt.case_name) {
          continue;
        }

        const body = expand_dynamic_if_let_control_body(
          stmt,
          target,
          env,
          hooks,
          state,
          expanders,
        );
        statements.push(...body.statements);
        continue;
      }

      const conditional_body = dynamic_conditional_loop_control_body(
        stmt.body,
        state,
      );

      if (conditional_body) {
        statements.push(
          guard_loop_step(state, [{
            tag: "if_let_stmt",
            case_name: stmt.case_name,
            value_name: stmt.value_name,
            target: stmt.target,
            body: conditional_body,
          }]),
        );
        continue;
      }

      if (contains_loop_control(stmt.body)) {
        const body = expand_dynamic_loop_control_body(
          stmt.body,
          env,
          hooks,
          state,
          expanders,
        );
        statements.push(
          guard_loop_step(state, [{
            tag: "if_let_stmt",
            case_name: stmt.case_name,
            value_name: stmt.value_name,
            target: stmt.target,
            body: body.statements,
          }]),
        );
        continue;
      }

      statements.push(guard_loop_step(state, [stmt]));
      continue;
    }

    statements.push(guard_loop_step(state, [stmt]));
  }

  return { statements, control: "none" };
}

function expand_dynamic_if_let_control_body(
  stmt: Extract<Stmt, { tag: "if_let_stmt" }>,
  target: { expr: Extract<FrontExpr, { tag: "union_case" }>; env: Env },
  env: Env,
  hooks: StaticLoopHooks,
  state: DynamicLoopState,
  expanders: StaticLoopBodyExpanders,
): ExpandedLoopBody {
  if (!stmt.value_name) {
    return expand_dynamic_loop_control_body(
      stmt.body,
      env,
      hooks,
      state,
      expanders,
    );
  }

  const body_env = clone_env(env);
  bind_static_if_let_payload(stmt, target, body_env, hooks);
  return expand_dynamic_loop_control_body(
    stmt.body,
    body_env,
    hooks,
    state,
    expanders,
  );
}

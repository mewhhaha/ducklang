import { expect } from "../expect.ts";
import type { FrontExpr } from "./ast.ts";
import {
  clone_linear_closures,
  type LinearClosureEnv,
  type LinearClosureRef,
  merge_used_linear_closures,
  resolve_linear_closure_ref,
} from "./linear_closure.ts";
import {
  consume_linear_branch_with_consumer,
  consume_linear_condition_with_consumer,
  merge_linear_branches,
} from "./linear_expr/branch.ts";
import type {
  LinearBranch,
  LinearExprHooks,
  LinearUseMode,
} from "./linear_expr/types.ts";

export type {
  LinearBranch,
  LinearExprHooks,
  LinearUseMode,
} from "./linear_expr/types.ts";

export function consume_linear_expr(
  expr: FrontExpr,
  available: Set<string>,
  mode: LinearUseMode,
  closures: LinearClosureEnv,
  active_calls: Set<string>,
  hooks: LinearExprHooks,
): string[] {
  const consumed: string[] = [];

  function consume(name: string): void {
    if (!available.has(name)) {
      throw new Error("Linear value " + name + " was already consumed");
    }

    if (consumed.includes(name)) {
      throw new Error("Linear value " + name + " used more than once");
    }

    available.delete(name);
    consumed.push(name);
  }

  function walk(item: FrontExpr, is_root: boolean): void {
    if (item.tag === "linear") {
      consume(item.name);
      return;
    }

    if (item.tag === "var" && available.has(item.name)) {
      if (mode === "final" && is_root) {
        consume(item.name);
        return;
      }

      throw new Error(
        "Linear value " + item.name + " used without explicit consumption",
      );
    }

    if (item.tag === "app") {
      const closure = resolve_linear_closure_ref(item.func, closures);

      if (closure && closure.expr.params.length === item.args.length) {
        consume_linear_closure_call(
          linear_closure_call_name(item.func),
          closure,
          item.args,
        );
        return;
      }

      if (
        item.func.tag === "field" && item.func.object.tag === "var" &&
        available.has(item.func.object.name)
      ) {
        consume(item.func.object.name);
      } else {
        walk(item.func, false);
      }

      for (const arg of item.args) {
        walk(arg, false);
      }

      return;
    }

    if (item.tag === "prim") {
      walk(item.left, false);
      walk(item.right, false);
      return;
    }

    if (item.tag === "field") {
      walk(item.object, false);
      return;
    }

    if (item.tag === "index") {
      walk(item.object, false);
      walk(item.index, false);
      return;
    }

    if (item.tag === "block") {
      const before = new Set(available);
      const block_closures = clone_linear_closures(closures);
      hooks.validate_linear_block(
        item.statements,
        available,
        block_closures,
        active_calls,
      );
      merge_used_linear_closures(closures, block_closures);

      for (const name of before) {
        if (!available.has(name) && !consumed.includes(name)) {
          consumed.push(name);
        }
      }

      return;
    }

    if (item.tag === "if") {
      consume_linear_condition_with_consumer(
        item.cond,
        available,
        closures,
        active_calls,
        hooks,
        consume_linear_expr,
      );
      const before = new Set(available);
      const then_branch = consume_linear_branch_with_consumer(
        item.then_branch,
        before,
        mode,
        closures,
        active_calls,
        hooks,
        consume_linear_expr,
      );
      const else_branch = consume_linear_branch_with_consumer(
        item.else_branch,
        before,
        mode,
        closures,
        active_calls,
        hooks,
        consume_linear_expr,
      );
      merge_linear_branches(
        available,
        consumed,
        closures,
        then_branch,
        else_branch,
      );
      return;
    }

    if (item.tag === "if_let") {
      consume_linear_condition_with_consumer(
        item.target,
        available,
        closures,
        active_calls,
        hooks,
        consume_linear_expr,
      );
      const before = new Set(available);
      const then_branch = consume_linear_branch_with_consumer(
        item.then_branch,
        before,
        mode,
        closures,
        active_calls,
        hooks,
        consume_linear_expr,
      );
      const else_branch = consume_linear_branch_with_consumer(
        item.else_branch,
        before,
        mode,
        closures,
        active_calls,
        hooks,
        consume_linear_expr,
      );
      merge_linear_branches(
        available,
        consumed,
        closures,
        then_branch,
        else_branch,
      );
      return;
    }
  }

  function linear_closure_call_name(func: FrontExpr): string {
    if (func.tag === "var") {
      return func.name;
    }

    return "<inline>";
  }

  function consume_linear_closure_call(
    name: string,
    closure: LinearClosureRef,
    args: FrontExpr[],
  ): void {
    if (active_calls.has(name)) {
      throw new Error(
        "Cannot validate recursive linear closure call yet: " + name,
      );
    }

    for (const arg of args) {
      walk(arg, false);
    }

    active_calls.add(name);
    const before = new Set(available);
    const local_available = new Set(available);
    const local_closures = clone_linear_closures(closures);
    const param_names = new Set<string>();

    for (const param of closure.expr.params) {
      param_names.add(param.name);
      local_closures.delete(param.name);

      if (param.is_linear) {
        local_available.add(param.name);
      } else {
        local_available.delete(param.name);
      }
    }

    if (closure.expr.body.tag === "block") {
      hooks.validate_linear_block(
        closure.expr.body.statements,
        local_available,
        local_closures,
        active_calls,
      );
    } else {
      consume_linear_expr(
        closure.expr.body,
        local_available,
        "final",
        local_closures,
        active_calls,
        hooks,
      );
    }

    active_calls.delete(name);

    for (const param of closure.expr.params) {
      if (param.is_linear && local_available.has(param.name)) {
        throw new Error("Linear value " + param.name + " was not consumed");
      }
    }

    let consumed_outer_linear = false;

    for (const used of before) {
      if (param_names.has(used)) {
        continue;
      }

      if (!local_available.has(used)) {
        consumed_outer_linear = true;
      }
    }

    if (consumed_outer_linear && closure.binding) {
      if (closures.used.has(closure.binding)) {
        throw new Error("Linear closure " + name + " was already consumed");
      }

      closures.used.add(closure.binding);
    }

    merge_used_linear_closures(closures, local_closures);

    for (const used of before) {
      if (param_names.has(used)) {
        continue;
      }

      if (!local_available.has(used)) {
        if (consumed.includes(used)) {
          throw new Error("Linear value " + used + " used more than once");
        }

        available.delete(used);
        consumed.push(used);
      }
    }
  }

  walk(expr, true);

  if (mode === "discard" && consumed.length > 0) {
    const name = consumed[0];
    expect(name, "Missing discarded linear value");
    throw new Error("Linear value " + name + " is consumed but not rebound");
  }

  return consumed;
}

export function consume_linear_condition(
  expr: FrontExpr,
  available: Set<string>,
  closures: LinearClosureEnv,
  active_calls: Set<string>,
  hooks: LinearExprHooks,
): void {
  consume_linear_condition_with_consumer(
    expr,
    available,
    closures,
    active_calls,
    hooks,
    consume_linear_expr,
  );
}

export function consume_linear_branch(
  expr: FrontExpr,
  available: Set<string>,
  mode: LinearUseMode,
  closures: LinearClosureEnv,
  active_calls: Set<string>,
  hooks: LinearExprHooks,
): LinearBranch {
  return consume_linear_branch_with_consumer(
    expr,
    available,
    mode,
    closures,
    active_calls,
    hooks,
    consume_linear_expr,
  );
}

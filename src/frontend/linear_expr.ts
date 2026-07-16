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
import {
  linear_binding_related,
  type LinearRelatedSubject,
  LinearState,
  throw_linear_diagnostic,
  throw_unused_linear_value,
} from "./linear_state.ts";

export type {
  LinearBranch,
  LinearExprHooks,
  LinearUseMode,
} from "./linear_expr/types.ts";

export function consume_linear_expr(
  expr: FrontExpr,
  available: LinearState,
  mode: LinearUseMode,
  closures: LinearClosureEnv,
  active_calls: Set<string>,
  hooks: LinearExprHooks,
): string[] {
  const consumed: string[] = [];

  function consume(name: string, value: FrontExpr): void {
    if (consumed.includes(name) && available.has(name)) {
      throw_linear_diagnostic(
        "DUCK2201",
        "Linear value " + name + " used more than once",
        value,
        linear_binding_related(available, name),
      );
    }

    available.consume(name, value);
    consumed.push(name);
  }

  function walk(item: FrontExpr, is_root: boolean): void {
    if (item.tag === "linear") {
      consume(item.name, item);
      return;
    }

    if (item.tag === "var" && available.has(item.name)) {
      if (mode === "final" && is_root) {
        consume(item.name, item);
        return;
      }

      throw_linear_diagnostic(
        "DUCK2204",
        "Linear value " + item.name + " used without explicit consumption",
        item,
        linear_binding_related(available, item.name),
      );
    }

    if (item.tag === "app") {
      const closure = resolve_linear_closure_ref(item.func, closures);

      if (closure && closure.expr.params.length === item.args.length) {
        consume_linear_closure_call(
          linear_closure_call_name(item.func),
          closure,
          item.args,
          item,
        );
        return;
      }

      if (
        item.func.tag === "field" && item.func.object.tag === "var" &&
        available.has(item.func.object.name)
      ) {
        consume(item.func.object.name, item.func.object);
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
      const before = available.clone();
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
      const before = available.clone();
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
        item,
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
      const before = available.clone();
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
        item,
        available,
        consumed,
        closures,
        then_branch,
        else_branch,
      );
      return;
    }

    if (item.tag === "match") {
      consume_linear_condition_with_consumer(
        item.target,
        available,
        closures,
        active_calls,
        hooks,
        consume_linear_expr,
      );
      const before = available.clone();
      let first_branch: LinearBranch | undefined;

      for (const arm of item.arms) {
        if (arm.guard !== undefined) {
          consume_linear_condition_with_consumer(
            arm.guard,
            before,
            closures,
            active_calls,
            hooks,
            consume_linear_expr,
          );
        }

        const branch = consume_linear_branch_with_consumer(
          arm.body,
          before,
          mode,
          closures,
          active_calls,
          hooks,
          consume_linear_expr,
        );

        if (!first_branch) {
          first_branch = branch;
          continue;
        }

        merge_linear_branches(
          item,
          available,
          consumed,
          closures,
          first_branch,
          branch,
        );
      }

      if (!first_branch) {
        throw new Error("Match expression has no arms");
      }

      if (item.arms.length === 1) {
        available.replace_with(first_branch.available);

        for (const name of first_branch.consumed) {
          if (!consumed.includes(name)) {
            consumed.push(name);
          }
        }

        for (const id of first_branch.used_closures) {
          closures.used.add(id);
          const consumed_at = first_branch.closure_consumes.get(id);

          if (consumed_at) {
            closures.consumed_at.set(id, consumed_at);
          }
        }
      }

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
    call: Extract<FrontExpr, { tag: "app" }>,
  ): void {
    if (active_calls.has(name)) {
      throw_linear_diagnostic(
        "DUCK2290",
        "Cannot validate recursive linear closure call yet: " + name,
        call,
      );
    }

    for (const arg of args) {
      walk(arg, false);
    }

    active_calls.add(name);
    const before = available.clone();
    const local_available = available.clone();
    const local_closures = clone_linear_closures(closures);
    const param_names = new Set<string>();

    for (const param of closure.expr.params) {
      param_names.add(param.name);
      local_closures.delete(param.name);

      if (param.is_linear) {
        local_available.bind(param.name, param);
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
        throw_unused_linear_value(param.name, param);
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
        const related: LinearRelatedSubject[] = [];
        const first_consume = closures.consumed_at.get(closure.binding);
        const declaration = closures.declarations.get(name);

        if (first_consume) {
          related.push({
            message: "Linear closure first consumed here",
            subject: first_consume,
          });
        }

        if (declaration) {
          related.push({
            message: "Linear closure declared here",
            subject: declaration,
          });
        }

        throw_linear_diagnostic(
          "DUCK2206",
          "Linear closure " + name + " was already consumed",
          call,
          related,
        );
      }

      closures.used.add(closure.binding);
      closures.consumed_at.set(closure.binding, call);
    }

    merge_used_linear_closures(closures, local_closures);

    for (const used of before) {
      if (param_names.has(used)) {
        continue;
      }

      if (!local_available.has(used)) {
        if (consumed.includes(used)) {
          throw_linear_diagnostic(
            "DUCK2201",
            "Linear value " + used + " used more than once",
            call,
            linear_binding_related(available, used),
          );
        }

        available.consume(used, call);
        consumed.push(used);
      }
    }
  }

  walk(expr, true);

  if (mode === "discard" && consumed.length > 0) {
    const name = consumed[0];
    expect(name, "Missing discarded linear value");
    throw_linear_diagnostic(
      "DUCK2203",
      "Linear value " + name + " is consumed but not rebound",
      expr,
      linear_binding_related(available, name),
    );
  }

  return consumed;
}

export function consume_linear_condition(
  expr: FrontExpr,
  available: LinearState,
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
  available: LinearState,
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

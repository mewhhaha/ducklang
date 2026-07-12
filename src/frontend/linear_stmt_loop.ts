import { expect } from "../expect.ts";
import type { FrontExpr, Stmt } from "./ast.ts";
import {
  bind_linear_closure,
  clone_linear_closures,
  type LinearClosureEnv,
  merge_used_linear_closures,
} from "./linear_closure.ts";
import type { LinearUseMode } from "./linear_expr.ts";
import {
  expect_same_linear_state,
  linear_block_exits,
  type LinearRelatedSubject,
  LinearState,
  throw_linear_diagnostic,
} from "./linear_state.ts";

export type LinearStmtLoopOps = {
  consume_condition: (
    expr: FrontExpr,
    available: LinearState,
    closures: LinearClosureEnv,
    active_calls: Set<string>,
  ) => void;
  consume_expr: (
    expr: FrontExpr,
    available: LinearState,
    mode: LinearUseMode,
    closures: LinearClosureEnv,
    active_calls: Set<string>,
  ) => string[];
  validate_linear_assignment: (
    stmt: Extract<Stmt, { tag: "assign" }>,
    available: LinearState,
    closures: LinearClosureEnv,
    active_calls: Set<string>,
    subject?: object,
  ) => void;
};

export function validate_linear_loop_body(
  stmts: Stmt[],
  available: LinearState,
  closures: LinearClosureEnv,
  active_calls: Set<string>,
  ops: LinearStmtLoopOps,
  subject: object,
): void {
  const before = available.clone();
  const local = available.clone();
  const local_closures = clone_linear_closures(closures);

  for (let index = 0; index < stmts.length; index += 1) {
    const stmt = stmts[index];
    expect(stmt, "Missing loop statement " + index);

    if (stmt.tag === "break" || stmt.tag === "continue") {
      expect_same_linear_state(before, local, stmt.tag, stmt);
      expect_same_linear_closure_state(
        closures,
        local_closures,
        stmt.tag,
        stmt,
      );
      return;
    }

    if (stmt.tag === "return") {
      ops.consume_expr(
        stmt.value,
        local,
        "final",
        local_closures,
        active_calls,
      );
      return;
    }

    if (stmt.tag === "assign") {
      ops.validate_linear_assignment(
        stmt,
        local,
        local_closures,
        active_calls,
        stmt,
      );
      bind_linear_closure(
        local_closures,
        stmt.name,
        stmt.value,
        local,
        stmt,
      );
    } else if (stmt.tag === "index_assign") {
      ops.consume_expr(
        stmt.index,
        local,
        "discard",
        local_closures,
        active_calls,
      );
      ops.validate_linear_assignment(
        { tag: "assign", name: stmt.name, mode: "same", value: stmt.value },
        local,
        local_closures,
        active_calls,
        stmt,
      );
      local_closures.delete(stmt.name);
    } else if (stmt.tag === "expr") {
      ops.consume_expr(
        stmt.expr,
        local,
        "discard",
        local_closures,
        active_calls,
      );
    } else if (stmt.tag === "bind") {
      if (stmt.is_linear) {
        ops.consume_expr(
          stmt.value,
          local,
          "bind",
          local_closures,
          active_calls,
        );
        local.bind(stmt.name, stmt);
        local_closures.delete(stmt.name);
      } else {
        ops.consume_expr(
          stmt.value,
          local,
          "discard",
          local_closures,
          active_calls,
        );
        bind_linear_closure(
          local_closures,
          stmt.name,
          stmt.value,
          local,
          stmt,
        );
      }
    } else if (stmt.tag === "for_range") {
      ops.consume_expr(
        stmt.start,
        local,
        "discard",
        local_closures,
        active_calls,
      );
      ops.consume_expr(
        stmt.end,
        local,
        "discard",
        local_closures,
        active_calls,
      );
      ops.consume_expr(
        stmt.step,
        local,
        "discard",
        local_closures,
        active_calls,
      );
      validate_linear_loop_body(
        stmt.body,
        local,
        local_closures,
        active_calls,
        ops,
        stmt,
      );
    } else if (stmt.tag === "for_collection") {
      ops.consume_expr(
        stmt.collection,
        local,
        "discard",
        local_closures,
        active_calls,
      );
      validate_linear_loop_body(
        stmt.body,
        local,
        local_closures,
        active_calls,
        ops,
        stmt,
      );
    } else if (stmt.tag === "if_stmt") {
      ops.consume_condition(stmt.cond, local, local_closures, active_calls);
      validate_linear_no_else_loop_branch(
        stmt.body,
        local,
        local_closures,
        active_calls,
        "if fallthrough",
        ops,
        stmt,
      );
    } else if (stmt.tag === "if_let_stmt") {
      ops.consume_condition(
        stmt.target,
        local,
        local_closures,
        active_calls,
      );
      validate_linear_no_else_loop_branch(
        stmt.body,
        local,
        local_closures,
        active_calls,
        "if let fallthrough",
        ops,
        stmt,
      );
    } else if (stmt.tag === "type_check") {
      ops.consume_expr(
        stmt.target,
        local,
        "discard",
        local_closures,
        active_calls,
      );
    } else if (stmt.tag === "import" || stmt.tag === "host_import") {
      continue;
    } else if (stmt.tag === "state_bind" || stmt.tag === "bind_pattern") {
      throw_linear_diagnostic(
        "IX2290",
        "Cannot validate linear " + stmt.tag + " yet",
        stmt,
      );
    } else if (stmt.tag === "resume_dup") {
      throw_linear_diagnostic(
        "IX2290",
        "Resumption duplication must be elaborated before linear validation",
        stmt,
      );
    } else {
      throw_linear_diagnostic(
        "IX2290",
        "Cannot validate linear " + stmt.feature + " yet",
        stmt,
      );
    }
  }

  expect_same_linear_state(before, local, "fallthrough", subject);
  expect_same_linear_closure_state(
    closures,
    local_closures,
    "fallthrough",
    subject,
  );
  merge_used_linear_closures(closures, local_closures);
}

export function expect_same_linear_closure_state(
  before: LinearClosureEnv,
  after: LinearClosureEnv,
  edge: string,
  subject: object,
): void {
  if (same_linear_closure_used_state(before, after)) {
    return;
  }

  const related: LinearRelatedSubject[] = [];

  for (const binding of after.used) {
    if (before.used.has(binding)) {
      continue;
    }

    const first_consume = after.consumed_at.get(binding);

    if (first_consume) {
      related.push({
        message: "Linear closure consumed on this path",
        subject: first_consume,
      });
    }

    for (const [name, declaration] of after.declarations) {
      if (after.get(name) === binding) {
        related.push({
          message: "Linear closure declared here",
          subject: declaration,
        });
        break;
      }
    }

    break;
  }

  throw_linear_diagnostic(
    "IX2205",
    "Linear closures must be consumed on every " + edge + " path",
    subject,
    related,
  );
}

function validate_linear_no_else_loop_branch(
  stmts: Stmt[],
  available: LinearState,
  closures: LinearClosureEnv,
  active_calls: Set<string>,
  edge: string,
  ops: LinearStmtLoopOps,
  subject: object,
): void {
  const before = available.clone();
  const branch = available.clone();
  const branch_closures = clone_linear_closures(closures);
  validate_linear_loop_body(
    stmts,
    branch,
    branch_closures,
    new Set(active_calls),
    ops,
    subject,
  );

  if (linear_block_exits(stmts)) {
    return;
  }

  expect_same_linear_state(before, branch, edge, subject);
  expect_same_linear_closure_state(
    closures,
    branch_closures,
    edge,
    subject,
  );
  merge_used_linear_closures(closures, branch_closures);
}

function same_linear_closure_used_state(
  before: LinearClosureEnv,
  after: LinearClosureEnv,
): boolean {
  if (before.used.size !== after.used.size) {
    return false;
  }

  for (const binding of before.used) {
    if (!after.used.has(binding)) {
      return false;
    }
  }

  return true;
}

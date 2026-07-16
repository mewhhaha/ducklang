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
      if (linear_loop_expr_contains_control(stmt.expr)) {
        const falls_through = validate_linear_loop_control_expr(
          stmt.expr,
          local,
          local_closures,
          active_calls,
          ops,
        );

        if (!falls_through) {
          return;
        }
      } else {
        ops.consume_expr(
          stmt.expr,
          local,
          "discard",
          local_closures,
          active_calls,
        );
      }
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
        "DUCK2290",
        "Cannot validate linear " + stmt.tag + " yet",
        stmt,
      );
    } else if (stmt.tag === "resume_dup") {
      throw_linear_diagnostic(
        "DUCK2290",
        "Resumption duplication must be elaborated before linear validation",
        stmt,
      );
    } else {
      throw_linear_diagnostic(
        "DUCK2290",
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

function validate_linear_loop_control_expr(
  expr: FrontExpr,
  available: LinearState,
  closures: LinearClosureEnv,
  active_calls: Set<string>,
  ops: LinearStmtLoopOps,
): boolean {
  if (expr.tag === "block") {
    validate_linear_loop_body(
      expr.statements,
      available,
      closures,
      active_calls,
      ops,
      expr,
    );
    return !linear_loop_expr_definitely_exits(expr);
  }

  if (expr.tag === "if") {
    ops.consume_condition(expr.cond, available, closures, active_calls);
    return validate_linear_loop_control_branches(
      expr,
      expr.then_branch,
      expr.else_branch,
      available,
      closures,
      active_calls,
      ops,
    );
  }

  if (expr.tag === "if_let") {
    ops.consume_condition(expr.target, available, closures, active_calls);
    return validate_linear_loop_control_branches(
      expr,
      expr.then_branch,
      expr.else_branch,
      available,
      closures,
      active_calls,
      ops,
    );
  }

  if (expr.tag === "match") {
    ops.consume_condition(expr.target, available, closures, active_calls);
    return validate_linear_loop_match_branches(
      expr,
      available,
      closures,
      active_calls,
      ops,
    );
  }

  ops.consume_expr(expr, available, "discard", closures, active_calls);
  return true;
}

function validate_linear_loop_match_branches(
  expr: Extract<FrontExpr, { tag: "match" }>,
  available: LinearState,
  closures: LinearClosureEnv,
  active_calls: Set<string>,
  ops: LinearStmtLoopOps,
): boolean {
  let fallthrough_available: LinearState | undefined;
  let fallthrough_closures: LinearClosureEnv | undefined;

  for (const arm of expr.arms) {
    const arm_available = available.clone();
    const arm_closures = clone_linear_closures(closures);

    if (arm.guard !== undefined) {
      ops.consume_condition(
        arm.guard,
        arm_available,
        arm_closures,
        new Set(active_calls),
      );
    }

    const falls_through = validate_linear_loop_control_branch(
      arm.body,
      arm_available,
      arm_closures,
      active_calls,
      ops,
    );

    if (!falls_through) {
      continue;
    }

    if (!fallthrough_available || !fallthrough_closures) {
      fallthrough_available = arm_available;
      fallthrough_closures = arm_closures;
      continue;
    }

    expect_same_linear_state(
      fallthrough_available,
      arm_available,
      "match arm",
      expr,
    );
    expect_same_linear_closure_state(
      fallthrough_closures,
      arm_closures,
      "match arm",
      expr,
    );
  }

  if (!fallthrough_available || !fallthrough_closures) {
    return false;
  }

  available.replace_with(fallthrough_available);
  merge_used_linear_closures(closures, fallthrough_closures);
  return true;
}

function validate_linear_loop_control_branches(
  subject: FrontExpr,
  left_expr: FrontExpr,
  right_expr: FrontExpr,
  available: LinearState,
  closures: LinearClosureEnv,
  active_calls: Set<string>,
  ops: LinearStmtLoopOps,
): boolean {
  const left_available = available.clone();
  const left_closures = clone_linear_closures(closures);
  const left_falls_through = validate_linear_loop_control_branch(
    left_expr,
    left_available,
    left_closures,
    active_calls,
    ops,
  );
  const right_available = available.clone();
  const right_closures = clone_linear_closures(closures);
  const right_falls_through = validate_linear_loop_control_branch(
    right_expr,
    right_available,
    right_closures,
    active_calls,
    ops,
  );

  if (!left_falls_through && !right_falls_through) {
    return false;
  }

  if (!left_falls_through) {
    available.replace_with(right_available);
    merge_used_linear_closures(closures, right_closures);
    return true;
  }

  if (!right_falls_through) {
    available.replace_with(left_available);
    merge_used_linear_closures(closures, left_closures);
    return true;
  }

  expect_same_linear_state(
    left_available,
    right_available,
    "expression branch",
    subject,
  );
  expect_same_linear_closure_state(
    left_closures,
    right_closures,
    "expression branch",
    subject,
  );
  available.replace_with(left_available);
  merge_used_linear_closures(closures, left_closures);
  return true;
}

function validate_linear_loop_control_branch(
  expr: FrontExpr,
  available: LinearState,
  closures: LinearClosureEnv,
  active_calls: Set<string>,
  ops: LinearStmtLoopOps,
): boolean {
  if (linear_loop_expr_contains_control(expr)) {
    return validate_linear_loop_control_expr(
      expr,
      available,
      closures,
      new Set(active_calls),
      ops,
    );
  }

  ops.consume_expr(
    expr,
    available,
    "discard",
    closures,
    new Set(active_calls),
  );
  return true;
}

function linear_loop_expr_contains_control(expr: FrontExpr): boolean {
  if (expr.tag === "block") {
    for (const stmt of expr.statements) {
      if (stmt.tag === "break" || stmt.tag === "continue") {
        return true;
      }

      if (stmt.tag === "for_range" || stmt.tag === "for_collection") {
        continue;
      }

      if (stmt.tag === "if_stmt" || stmt.tag === "if_let_stmt") {
        if (linear_loop_statements_contain_control(stmt.body)) {
          return true;
        }
        continue;
      }

      if (stmt.tag === "expr") {
        if (linear_loop_expr_contains_control(stmt.expr)) {
          return true;
        }
      }
    }

    return false;
  }

  if (expr.tag === "if") {
    return linear_loop_expr_contains_control(expr.then_branch) ||
      linear_loop_expr_contains_control(expr.else_branch);
  }

  if (expr.tag === "if_let") {
    return linear_loop_expr_contains_control(expr.then_branch) ||
      linear_loop_expr_contains_control(expr.else_branch);
  }

  if (expr.tag === "match") {
    for (const arm of expr.arms) {
      if (linear_loop_expr_contains_control(arm.body)) {
        return true;
      }
    }
  }

  return false;
}

function linear_loop_statements_contain_control(stmts: Stmt[]): boolean {
  return linear_loop_expr_contains_control({ tag: "block", statements: stmts });
}

function linear_loop_expr_definitely_exits(expr: FrontExpr): boolean {
  if (expr.tag === "block") {
    for (const stmt of expr.statements) {
      if (
        stmt.tag === "break" || stmt.tag === "continue" ||
        stmt.tag === "return"
      ) {
        return true;
      }

      if (
        stmt.tag === "expr" &&
        linear_loop_expr_definitely_exits(stmt.expr)
      ) {
        return true;
      }
    }

    return false;
  }

  if (expr.tag === "if") {
    return linear_loop_expr_definitely_exits(expr.then_branch) &&
      linear_loop_expr_definitely_exits(expr.else_branch);
  }

  if (expr.tag === "if_let") {
    return linear_loop_expr_definitely_exits(expr.then_branch) &&
      linear_loop_expr_definitely_exits(expr.else_branch);
  }

  if (expr.tag === "match") {
    if (expr.arms.length === 0) {
      return false;
    }

    for (const arm of expr.arms) {
      if (!linear_loop_expr_definitely_exits(arm.body)) {
        return false;
      }
    }

    return true;
  }

  return false;
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
    "DUCK2205",
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

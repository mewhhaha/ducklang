import { expect } from "../expect.ts";
import type { FrontExpr, Stmt } from "./ast.ts";
import {
  bind_linear_closure,
  clone_linear_closures,
  create_linear_closures,
  type LinearClosureEnv,
  merge_used_linear_closures,
} from "./linear_closure.ts";
import {
  consume_linear_condition as consume_linear_condition_with_hooks,
  consume_linear_expr as consume_linear_expr_with_hooks,
  type LinearExprHooks,
  type LinearUseMode,
} from "./linear_expr.ts";
import {
  create_linear_state,
  expect_same_linear_state,
  linear_binding_related,
  linear_block_exits,
  LinearState,
  throw_linear_diagnostic,
  throw_unused_linear_value,
} from "./linear_state.ts";
import {
  expect_same_linear_closure_state,
  type LinearStmtLoopOps,
  validate_linear_loop_body as validate_linear_loop_body_with_ops,
} from "./linear_stmt_loop.ts";

const linear_expr_hooks = {
  validate_linear_block,
} satisfies LinearExprHooks;

const linear_stmt_loop_ops = {
  consume_condition,
  consume_expr,
  validate_linear_assignment,
} satisfies LinearStmtLoopOps;

function consume_expr(
  expr: FrontExpr,
  available: LinearState,
  mode: LinearUseMode,
  closures: LinearClosureEnv,
  active_calls: Set<string> = new Set(),
): string[] {
  return consume_linear_expr_with_hooks(
    expr,
    available,
    mode,
    closures,
    active_calls,
    linear_expr_hooks,
  );
}

function consume_condition(
  expr: FrontExpr,
  available: LinearState,
  closures: LinearClosureEnv,
  active_calls: Set<string>,
): void {
  consume_linear_condition_with_hooks(
    expr,
    available,
    closures,
    active_calls,
    linear_expr_hooks,
  );
}

export function validate_linear_lam(
  expr: Extract<FrontExpr, { tag: "lam" }>,
): void {
  validate_linear_callable(expr);
}

export function validate_linear_rec(
  expr: Extract<FrontExpr, { tag: "rec" }>,
): void {
  validate_linear_callable(expr);
}

function validate_linear_callable(
  expr:
    | Extract<FrontExpr, { tag: "lam" }>
    | Extract<FrontExpr, { tag: "rec" }>,
): void {
  const available = create_linear_state();
  const closures = create_linear_closures();

  for (const param of expr.params) {
    if (param.is_linear) {
      available.bind(param.name, param);
    }
  }

  if (expr.body.tag === "block") {
    validate_linear_block(expr.body.statements, available, closures);
  } else {
    consume_expr(expr.body, available, "final", closures);
  }

  for (const name of available) {
    const binding = available.bindings.get(name);
    if (binding) {
      throw_unused_linear_value(name, binding.declaration);
    }
    throw new Error("Linear value " + name + " was not consumed");
  }
}

export function validate_linear_rest(
  name: string,
  stmts: Stmt[],
  declaration?: object,
): void {
  const available = create_linear_state();
  if (declaration) {
    available.bind(name, declaration);
  } else {
    available.add(name);
  }
  const closures = create_linear_closures();
  validate_linear_block(stmts, available, closures);

  for (const item of available) {
    const binding = available.bindings.get(item);
    if (binding) {
      throw_unused_linear_value(item, binding.declaration);
    }
    throw new Error("Linear value " + item + " was not consumed");
  }
}

function validate_linear_block(
  stmts: Stmt[],
  available: LinearState,
  closures: LinearClosureEnv,
  active_calls: Set<string> = new Set(),
): void {
  for (let index = 0; index < stmts.length; index += 1) {
    const stmt = stmts[index];
    expect(stmt, "Missing statement " + index);
    const is_final = index + 1 >= stmts.length;

    if (stmt.tag === "assign") {
      validate_linear_assignment(stmt, available, closures, active_calls);
      bind_linear_closure(closures, stmt.name, stmt.value, available, stmt);
    } else if (stmt.tag === "index_assign") {
      consume_expr(
        stmt.index,
        available,
        "discard",
        closures,
        active_calls,
      );
      validate_linear_assignment(
        { tag: "assign", name: stmt.name, mode: "same", value: stmt.value },
        available,
        closures,
        active_calls,
        stmt,
      );
      closures.delete(stmt.name);
    } else if (stmt.tag === "expr") {
      if (is_final) {
        consume_expr(
          stmt.expr,
          available,
          "final",
          closures,
          active_calls,
        );
      } else {
        consume_expr(
          stmt.expr,
          available,
          "discard",
          closures,
          active_calls,
        );
      }
    } else if (stmt.tag === "return") {
      consume_expr(
        stmt.value,
        available,
        "final",
        closures,
        active_calls,
      );
      return;
    } else if (stmt.tag === "bind") {
      if (stmt.is_linear) {
        consume_expr(
          stmt.value,
          available,
          "bind",
          closures,
          active_calls,
        );
        available.bind(stmt.name, stmt);
        closures.delete(stmt.name);
      } else {
        consume_expr(
          stmt.value,
          available,
          "discard",
          closures,
          active_calls,
        );
        bind_linear_closure(closures, stmt.name, stmt.value, available, stmt);
      }
    } else if (stmt.tag === "for_range") {
      consume_expr(
        stmt.start,
        available,
        "discard",
        closures,
        active_calls,
      );
      consume_expr(
        stmt.end,
        available,
        "discard",
        closures,
        active_calls,
      );
      consume_expr(
        stmt.step,
        available,
        "discard",
        closures,
        active_calls,
      );
      validate_linear_loop_body_with_ops(
        stmt.body,
        available,
        closures,
        active_calls,
        linear_stmt_loop_ops,
        stmt,
      );
    } else if (stmt.tag === "for_collection") {
      consume_expr(
        stmt.collection,
        available,
        "discard",
        closures,
        active_calls,
      );
      validate_linear_loop_body_with_ops(
        stmt.body,
        available,
        closures,
        active_calls,
        linear_stmt_loop_ops,
        stmt,
      );
    } else if (stmt.tag === "if_stmt") {
      consume_condition(stmt.cond, available, closures, active_calls);
      validate_linear_no_else_branch(
        stmt.body,
        available,
        closures,
        active_calls,
        "if fallthrough",
        stmt,
      );
    } else if (stmt.tag === "if_let_stmt") {
      consume_condition(stmt.target, available, closures, active_calls);
      validate_linear_no_else_branch(
        stmt.body,
        available,
        closures,
        active_calls,
        "if let fallthrough",
        stmt,
      );
    } else if (stmt.tag === "type_check") {
      consume_expr(
        stmt.target,
        available,
        "discard",
        closures,
        active_calls,
      );
    } else if (stmt.tag === "import" || stmt.tag === "host_import") {
      continue;
    } else if (stmt.tag === "break") {
      throw_linear_diagnostic(
        "IX2290",
        "Cannot lower break outside static range loop",
        stmt,
      );
    } else if (stmt.tag === "continue") {
      throw_linear_diagnostic(
        "IX2290",
        "Cannot lower continue outside static range loop",
        stmt,
      );
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
}

function validate_linear_no_else_branch(
  stmts: Stmt[],
  available: LinearState,
  closures: LinearClosureEnv,
  active_calls: Set<string>,
  edge: string,
  subject: object,
): void {
  const before = available.clone();
  const branch = available.clone();
  const branch_closures = clone_linear_closures(closures);
  validate_linear_block(
    stmts,
    branch,
    branch_closures,
    new Set(active_calls),
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

function validate_linear_assignment(
  stmt: Extract<Stmt, { tag: "assign" }>,
  available: LinearState,
  closures: LinearClosureEnv,
  active_calls: Set<string>,
  subject?: object,
): void {
  let diagnostic_subject: object = stmt;

  if (subject !== undefined) {
    diagnostic_subject = subject;
  }

  const was_available = available.has(stmt.name);
  const consumed = consume_expr(
    stmt.value,
    available,
    "assignment",
    closures,
    active_calls,
  );

  if (consumed.length > 0) {
    if (consumed.length !== 1) {
      throw_linear_diagnostic(
        "IX2207",
        "Linear assignment must consume exactly one value",
        diagnostic_subject,
      );
    }
    const name = consumed[0];
    expect(name, "Missing consumed linear value");

    if (name !== stmt.name) {
      throw_linear_diagnostic(
        "IX2207",
        "Linear value " + name + " must be rebound as " + name,
        diagnostic_subject,
        linear_binding_related(available, name),
      );
    }

    const binding = available.bindings.get(name);
    if (binding) {
      available.bind(stmt.name, binding.declaration);
    } else {
      available.add(stmt.name);
    }
  } else if (was_available) {
    throw_linear_diagnostic(
      "IX2207",
      "Linear value " + stmt.name + " was rebound without being consumed",
      diagnostic_subject,
      linear_binding_related(available, stmt.name),
    );
  }
}

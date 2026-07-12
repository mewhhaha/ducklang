import type { Core, CoreExpr, CoreField, CoreStmt } from "./ast.ts";
import {
  core_scratch_exit_edges,
  type CoreCleanupExitEdge,
} from "./cleanup.ts";
import { canonical_core_subject } from "./subject_provenance.ts";

export type CoreLifetimeSubject = CoreExpr | CoreStmt;

export type CoreLifetimeScope =
  | {
    id: string;
    kind: "program" | "block" | "loop" | "function_call" | "closure";
    parent: string | undefined;
    boundary: CoreLifetimeBoundary;
  }
  | {
    id: string;
    kind: "scratch";
    parent: string | undefined;
    boundary: "scratchpad";
    exit_edges: CoreCleanupExitEdge[];
  };

export type CoreLifetimeBoundary =
  | "program"
  | "block"
  | "loop_iteration"
  | "function_call"
  | "closure_environment";

export type CoreLifetimePlan = {
  scopes: CoreLifetimeScope[];
};

type CoreLifetimeScopeKind = CoreLifetimeScope["kind"];

type CoreLifetimeState = {
  next_program: number;
  next_block: number;
  next_loop: number;
  next_function_call: number;
  next_closure: number;
  next_scratch: number;
  scopes: CoreLifetimeScope[];
  subject_scopes: WeakMap<CoreLifetimeSubject, CoreLifetimeScope>;
};

const subject_scopes_by_plan = new WeakMap<
  CoreLifetimePlan,
  WeakMap<CoreLifetimeSubject, CoreLifetimeScope>
>();

export function core_lifetime_plan(core: Core): CoreLifetimePlan {
  const state: CoreLifetimeState = {
    next_program: 0,
    next_block: 0,
    next_loop: 0,
    next_function_call: 0,
    next_closure: 0,
    next_scratch: 0,
    scopes: [],
    subject_scopes: new WeakMap(),
  };
  const program = add_scope(state, "program", undefined, undefined);

  for (const stmt of core.statements) {
    scan_lifetime_stmt(stmt, program.id, state);
  }

  const plan = { scopes: state.scopes };
  subject_scopes_by_plan.set(plan, state.subject_scopes);
  return plan;
}

export function core_lifetime_scope_for_subject(
  plan: CoreLifetimePlan,
  subject: CoreLifetimeSubject,
): CoreLifetimeScope | undefined {
  const subject_scopes = subject_scopes_by_plan.get(plan);
  if (!subject_scopes) {
    return undefined;
  }

  return subject_scopes.get(canonical_core_subject(subject));
}

export function core_require_lifetime_scope_for_subject(
  plan: CoreLifetimePlan,
  subject: CoreLifetimeSubject,
): CoreLifetimeScope {
  const scope = core_lifetime_scope_for_subject(plan, subject);
  if (scope) {
    return scope;
  }

  throw new Error(
    "Missing lifetime scope provenance for Core subject: " + subject.tag,
  );
}

function scan_lifetime_expr(
  expr: CoreExpr,
  parent: string,
  state: CoreLifetimeState,
): void {
  if (expr.tag !== "app") {
    record_subject_scope(expr, parent, state);
  }

  switch (expr.tag) {
    case "num":
    case "text":
    case "type_name":
    case "var":
    case "linear":
    case "struct_type":
    case "union_type":
    case "unsupported":
      return;

    case "lam":
    case "rec": {
      const scope = add_scope(state, "closure", parent, undefined);
      scan_lifetime_expr(expr.body, scope.id, state);
      return;
    }

    case "prim":
      for (const arg of expr.args) {
        scan_lifetime_expr(arg, parent, state);
      }
      return;

    case "app": {
      const scope = add_scope(state, "function_call", parent, undefined);
      record_subject_scope(expr, scope.id, state);
      scan_lifetime_expr(expr.func, scope.id, state);

      for (const arg of expr.args) {
        scan_lifetime_expr(arg, scope.id, state);
      }
      return;
    }

    case "block": {
      const scope = add_scope(state, "block", parent, undefined);
      scan_lifetime_stmts(expr.statements, scope.id, state);
      return;
    }

    case "loop": {
      const scope = add_scope(state, "loop", parent, undefined);
      scan_lifetime_stmts(expr.body, scope.id, state);
      return;
    }

    case "comptime":
      scan_lifetime_expr(expr.expr, parent, state);
      return;

    case "borrow":
    case "freeze":
      scan_lifetime_expr(expr.value, parent, state);
      return;

    case "scratch": {
      const scope = add_scope(
        state,
        "scratch",
        parent,
        core_scratch_exit_edges(expr.body),
      );
      scan_lifetime_expr(expr.body, scope.id, state);
      return;
    }

    case "with":
      scan_lifetime_expr(expr.base, parent, state);
      scan_lifetime_fields(expr.fields, parent, state);
      return;

    case "struct_value":
      scan_lifetime_expr(expr.type_expr, parent, state);
      scan_lifetime_fields(expr.fields, parent, state);
      return;

    case "struct_update":
      scan_lifetime_expr(expr.base, parent, state);
      scan_lifetime_fields(expr.fields, parent, state);
      return;

    case "if":
      scan_lifetime_expr(expr.cond, parent, state);
      scan_lifetime_expr(expr.then_branch, parent, state);
      scan_lifetime_expr(expr.else_branch, parent, state);
      return;

    case "if_let":
      scan_lifetime_expr(expr.target, parent, state);
      scan_lifetime_expr(expr.then_branch, parent, state);
      scan_lifetime_expr(expr.else_branch, parent, state);
      return;

    case "field":
      scan_lifetime_expr(expr.object, parent, state);
      return;

    case "index":
      scan_lifetime_expr(expr.object, parent, state);
      scan_lifetime_expr(expr.index, parent, state);
      return;

    case "union_case":
      if (expr.value) {
        scan_lifetime_expr(expr.value, parent, state);
      }

      if (expr.type_expr) {
        scan_lifetime_expr(expr.type_expr, parent, state);
      }
      return;
  }
}

function scan_lifetime_stmts(
  statements: CoreStmt[],
  parent: string,
  state: CoreLifetimeState,
): void {
  for (const stmt of statements) {
    scan_lifetime_stmt(stmt, parent, state);
  }
}

function scan_lifetime_stmt(
  stmt: CoreStmt,
  parent: string,
  state: CoreLifetimeState,
): void {
  if (stmt.tag !== "range_loop" && stmt.tag !== "collection_loop") {
    record_subject_scope(stmt, parent, state);
  }

  switch (stmt.tag) {
    case "bind":
    case "assign":
      scan_lifetime_expr(stmt.value, parent, state);
      return;

    case "index_assign":
      scan_lifetime_expr(stmt.index, parent, state);
      scan_lifetime_expr(stmt.value, parent, state);
      return;

    case "range_loop": {
      scan_lifetime_expr(stmt.start, parent, state);
      scan_lifetime_expr(stmt.end, parent, state);
      scan_lifetime_expr(stmt.step, parent, state);
      const scope = add_scope(state, "loop", parent, undefined);
      record_subject_scope(stmt, scope.id, state);
      scan_lifetime_stmts(stmt.body, scope.id, state);
      return;
    }

    case "collection_loop": {
      scan_lifetime_expr(stmt.collection, parent, state);
      const scope = add_scope(state, "loop", parent, undefined);
      record_subject_scope(stmt, scope.id, state);
      scan_lifetime_stmts(stmt.body, scope.id, state);
      return;
    }

    case "if_stmt": {
      scan_lifetime_expr(stmt.cond, parent, state);
      const scope = add_scope(state, "block", parent, undefined);
      scan_lifetime_stmts(stmt.body, scope.id, state);
      return;
    }

    case "if_else_stmt": {
      scan_lifetime_expr(stmt.cond, parent, state);
      const then_scope = add_scope(state, "block", parent, undefined);
      scan_lifetime_stmts(stmt.then_body, then_scope.id, state);
      const else_scope = add_scope(state, "block", parent, undefined);
      scan_lifetime_stmts(stmt.else_body, else_scope.id, state);
      return;
    }

    case "if_let_stmt": {
      scan_lifetime_expr(stmt.target, parent, state);
      const scope = add_scope(state, "block", parent, undefined);
      scan_lifetime_stmts(stmt.body, scope.id, state);
      return;
    }

    case "type_check":
      scan_lifetime_expr(stmt.target, parent, state);
      return;

    case "return":
      scan_lifetime_expr(stmt.value, parent, state);
      return;

    case "expr":
      scan_lifetime_expr(stmt.expr, parent, state);
      return;

    case "break":
      if (stmt.value) {
        scan_lifetime_expr(stmt.value, parent, state);
      }
      return;
    case "continue":
    case "unsupported":
      return;
  }
}

function record_subject_scope(
  subject: CoreLifetimeSubject,
  scope_id: string,
  state: CoreLifetimeState,
): void {
  const scope = state.scopes.find((candidate) => candidate.id === scope_id);
  if (!scope) {
    throw new Error(
      "Missing lifetime scope while recording Core subject: " + scope_id,
    );
  }

  const existing = state.subject_scopes.get(subject);
  if (!existing) {
    state.subject_scopes.set(subject, scope);
    return;
  }

  if (existing.id === scope.id) {
    return;
  }

  throw new Error(
    "Core subject occurs in multiple lifetime scopes: " + subject.tag +
      " (" + existing.id + ", " + scope.id + ")",
  );
}

function scan_lifetime_fields(
  fields: CoreField[],
  parent: string,
  state: CoreLifetimeState,
): void {
  for (const field of fields) {
    scan_lifetime_expr(field.value, parent, state);
  }
}

function add_scope(
  state: CoreLifetimeState,
  kind: CoreLifetimeScopeKind,
  parent: string | undefined,
  exit_edges: CoreCleanupExitEdge[] | undefined,
): CoreLifetimeScope {
  const id = next_scope_id(state, kind);

  if (kind === "scratch") {
    const scope: CoreLifetimeScope = {
      id,
      kind,
      parent,
      boundary: "scratchpad",
      exit_edges: exit_edges_for_scratch(exit_edges),
    };
    state.scopes.push(scope);
    return scope;
  }

  const scope: CoreLifetimeScope = {
    id,
    kind,
    parent,
    boundary: boundary_for_kind(kind),
  };
  state.scopes.push(scope);
  return scope;
}

function next_scope_id(
  state: CoreLifetimeState,
  kind: CoreLifetimeScopeKind,
): string {
  switch (kind) {
    case "program": {
      const id = "program#" + state.next_program.toString();
      state.next_program += 1;
      return id;
    }

    case "block": {
      const id = "block#" + state.next_block.toString();
      state.next_block += 1;
      return id;
    }

    case "loop": {
      const id = "loop#" + state.next_loop.toString();
      state.next_loop += 1;
      return id;
    }

    case "function_call": {
      const id = "function_call#" + state.next_function_call.toString();
      state.next_function_call += 1;
      return id;
    }

    case "closure": {
      const id = "closure#" + state.next_closure.toString();
      state.next_closure += 1;
      return id;
    }

    case "scratch": {
      const id = "scratch#" + state.next_scratch.toString();
      state.next_scratch += 1;
      return id;
    }
  }
}

function boundary_for_kind(
  kind: Exclude<CoreLifetimeScopeKind, "scratch">,
): CoreLifetimeBoundary {
  switch (kind) {
    case "program":
      return "program";

    case "block":
      return "block";

    case "loop":
      return "loop_iteration";

    case "function_call":
      return "function_call";

    case "closure":
      return "closure_environment";
  }
}

function exit_edges_for_scratch(
  exit_edges: CoreCleanupExitEdge[] | undefined,
): CoreCleanupExitEdge[] {
  if (exit_edges) {
    return exit_edges;
  }

  return ["fallthrough"];
}

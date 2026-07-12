import type { CoreExpr, CoreField, CoreStmt } from "../ast.ts";
import { owner_list_text } from "./barrier.ts";
import { core_stmt_definitely_exits_sequence } from "./control.ts";
import type {
  CoreBorrowAliases,
  CoreBorrowEdge,
  CoreBorrowState,
  CoreStoredBorrowView,
} from "./types.ts";
import { record_core_diagnostic_subject } from "../source_origin.ts";

export function record_stored_borrow_view_escape(
  name: string,
  view: CoreStoredBorrowView,
  target_scope: string,
  state: CoreBorrowState,
  action: string,
  subject: CoreExpr,
): void {
  const id = "borrow#" + state.next_borrow.toString();
  state.next_borrow += 1;
  const edge: CoreBorrowEdge = {
    id,
    source_scope: view.scope,
    target_scope,
    ownership: {
      tag: "borrow_view",
      source: view.ownership,
    },
    decision: {
      tag: "rejected",
      reason: "stored borrow view " + name + " " + action +
        " borrowed owner " + owner_list_text(view.owners) + " from " +
        view.scope,
    },
  };
  state.edges.push(edge);
  record_core_diagnostic_subject(edge, subject);
}

export function record_captured_borrow_views(
  expr: CoreExpr,
  aliases: CoreBorrowAliases,
  target_scope: string,
  state: CoreBorrowState,
): void {
  const names = new Set<string>();
  collect_captured_borrow_view_names(
    expr,
    aliases,
    new Set(),
    names,
  );

  for (const name of names) {
    const view = aliases.views.get(name);

    if (!view) {
      continue;
    }

    record_stored_borrow_view_escape(
      name,
      view,
      target_scope,
      state,
      "cannot be captured by " + target_scope + " because it references",
      expr,
    );
  }
}

function collect_captured_borrow_view_names(
  expr: CoreExpr,
  aliases: CoreBorrowAliases,
  shadowed: Set<string>,
  names: Set<string>,
): void {
  switch (expr.tag) {
    case "num":
    case "text":
    case "type_name":
    case "linear":
    case "struct_type":
    case "union_type":
    case "unsupported":
      return;

    case "var":
      if (!shadowed.has(expr.name) && aliases.views.has(expr.name)) {
        names.add(expr.name);
      }
      return;

    case "lam":
    case "rec": {
      const inner_shadowed = new Set(shadowed);

      for (const param of expr.params) {
        inner_shadowed.add(param.name);
      }

      collect_captured_borrow_view_names(
        expr.body,
        aliases,
        inner_shadowed,
        names,
      );
      return;
    }

    case "prim":
      collect_exprs_captured_borrow_view_names(
        expr.args,
        aliases,
        shadowed,
        names,
      );
      return;

    case "app":
      collect_captured_borrow_view_names(
        expr.func,
        aliases,
        shadowed,
        names,
      );
      collect_exprs_captured_borrow_view_names(
        expr.args,
        aliases,
        shadowed,
        names,
      );
      return;

    case "block":
      collect_stmts_captured_borrow_view_names(
        expr.statements,
        aliases,
        new Set(shadowed),
        names,
      );
      return;

    case "loop":
      collect_stmts_captured_borrow_view_names(
        expr.body,
        aliases,
        new Set(shadowed),
        names,
      );
      return;

    case "comptime":
      collect_captured_borrow_view_names(
        expr.expr,
        aliases,
        shadowed,
        names,
      );
      return;

    case "borrow":
    case "freeze":
      collect_captured_borrow_view_names(
        expr.value,
        aliases,
        shadowed,
        names,
      );
      return;

    case "scratch":
      collect_captured_borrow_view_names(
        expr.body,
        aliases,
        shadowed,
        names,
      );
      return;

    case "with":
      collect_captured_borrow_view_names(
        expr.base,
        aliases,
        shadowed,
        names,
      );
      collect_fields_captured_borrow_view_names(
        expr.fields,
        aliases,
        shadowed,
        names,
      );
      return;

    case "struct_value":
      collect_captured_borrow_view_names(
        expr.type_expr,
        aliases,
        shadowed,
        names,
      );
      collect_fields_captured_borrow_view_names(
        expr.fields,
        aliases,
        shadowed,
        names,
      );
      return;

    case "struct_update":
      collect_captured_borrow_view_names(
        expr.base,
        aliases,
        shadowed,
        names,
      );
      collect_fields_captured_borrow_view_names(
        expr.fields,
        aliases,
        shadowed,
        names,
      );
      return;

    case "if":
      collect_captured_borrow_view_names(
        expr.cond,
        aliases,
        shadowed,
        names,
      );
      collect_captured_borrow_view_names(
        expr.then_branch,
        aliases,
        shadowed,
        names,
      );
      collect_captured_borrow_view_names(
        expr.else_branch,
        aliases,
        shadowed,
        names,
      );
      return;

    case "if_let": {
      collect_captured_borrow_view_names(
        expr.target,
        aliases,
        shadowed,
        names,
      );
      const then_shadowed = new Set(shadowed);

      if (expr.value_name) {
        then_shadowed.add(expr.value_name);
      }

      collect_captured_borrow_view_names(
        expr.then_branch,
        aliases,
        then_shadowed,
        names,
      );
      collect_captured_borrow_view_names(
        expr.else_branch,
        aliases,
        shadowed,
        names,
      );
      return;
    }

    case "field":
      collect_captured_borrow_view_names(
        expr.object,
        aliases,
        shadowed,
        names,
      );
      return;

    case "index":
      collect_captured_borrow_view_names(
        expr.object,
        aliases,
        shadowed,
        names,
      );
      collect_captured_borrow_view_names(
        expr.index,
        aliases,
        shadowed,
        names,
      );
      return;

    case "union_case":
      if (expr.value) {
        collect_captured_borrow_view_names(
          expr.value,
          aliases,
          shadowed,
          names,
        );
      }

      if (expr.type_expr) {
        collect_captured_borrow_view_names(
          expr.type_expr,
          aliases,
          shadowed,
          names,
        );
      }
      return;
  }
}

function collect_exprs_captured_borrow_view_names(
  exprs: CoreExpr[],
  aliases: CoreBorrowAliases,
  shadowed: Set<string>,
  names: Set<string>,
): void {
  for (const expr of exprs) {
    collect_captured_borrow_view_names(expr, aliases, shadowed, names);
  }
}

function collect_fields_captured_borrow_view_names(
  fields: CoreField[],
  aliases: CoreBorrowAliases,
  shadowed: Set<string>,
  names: Set<string>,
): void {
  for (const field of fields) {
    collect_captured_borrow_view_names(
      field.value,
      aliases,
      shadowed,
      names,
    );
  }
}

function collect_stmts_captured_borrow_view_names(
  statements: CoreStmt[],
  aliases: CoreBorrowAliases,
  shadowed: Set<string>,
  names: Set<string>,
): void {
  for (const stmt of statements) {
    collect_stmt_captured_borrow_view_names(stmt, aliases, shadowed, names);

    if (core_stmt_definitely_exits_sequence(stmt)) {
      return;
    }
  }
}

function collect_stmt_captured_borrow_view_names(
  stmt: CoreStmt,
  aliases: CoreBorrowAliases,
  shadowed: Set<string>,
  names: Set<string>,
): void {
  switch (stmt.tag) {
    case "bind":
      collect_captured_borrow_view_names(
        stmt.value,
        aliases,
        shadowed,
        names,
      );
      shadowed.add(stmt.name);
      return;

    case "assign":
      collect_captured_borrow_view_names(
        stmt.value,
        aliases,
        shadowed,
        names,
      );
      shadowed.add(stmt.name);
      return;

    case "index_assign":
      if (!shadowed.has(stmt.name) && aliases.views.has(stmt.name)) {
        names.add(stmt.name);
      }
      collect_captured_borrow_view_names(
        stmt.index,
        aliases,
        shadowed,
        names,
      );
      collect_captured_borrow_view_names(
        stmt.value,
        aliases,
        shadowed,
        names,
      );
      return;

    case "range_loop": {
      collect_captured_borrow_view_names(
        stmt.start,
        aliases,
        shadowed,
        names,
      );
      collect_captured_borrow_view_names(
        stmt.end,
        aliases,
        shadowed,
        names,
      );
      collect_captured_borrow_view_names(
        stmt.step,
        aliases,
        shadowed,
        names,
      );
      const body_shadowed = new Set(shadowed);
      body_shadowed.add(stmt.index);
      collect_stmts_captured_borrow_view_names(
        stmt.body,
        aliases,
        body_shadowed,
        names,
      );
      return;
    }

    case "collection_loop": {
      collect_captured_borrow_view_names(
        stmt.collection,
        aliases,
        shadowed,
        names,
      );
      const body_shadowed = new Set(shadowed);
      body_shadowed.add(stmt.item);

      if (stmt.index) {
        body_shadowed.add(stmt.index);
      }

      collect_stmts_captured_borrow_view_names(
        stmt.body,
        aliases,
        body_shadowed,
        names,
      );
      return;
    }

    case "if_stmt":
      collect_captured_borrow_view_names(
        stmt.cond,
        aliases,
        shadowed,
        names,
      );
      collect_stmts_captured_borrow_view_names(
        stmt.body,
        aliases,
        new Set(shadowed),
        names,
      );
      return;

    case "if_else_stmt":
      collect_captured_borrow_view_names(
        stmt.cond,
        aliases,
        shadowed,
        names,
      );
      collect_stmts_captured_borrow_view_names(
        stmt.then_body,
        aliases,
        new Set(shadowed),
        names,
      );
      collect_stmts_captured_borrow_view_names(
        stmt.else_body,
        aliases,
        new Set(shadowed),
        names,
      );
      return;

    case "if_let_stmt": {
      collect_captured_borrow_view_names(
        stmt.target,
        aliases,
        shadowed,
        names,
      );
      const body_shadowed = new Set(shadowed);

      if (stmt.value_name) {
        body_shadowed.add(stmt.value_name);
      }

      collect_stmts_captured_borrow_view_names(
        stmt.body,
        aliases,
        body_shadowed,
        names,
      );
      return;
    }

    case "type_check":
      collect_captured_borrow_view_names(
        stmt.target,
        aliases,
        shadowed,
        names,
      );
      return;

    case "return":
      collect_captured_borrow_view_names(
        stmt.value,
        aliases,
        shadowed,
        names,
      );
      return;

    case "expr":
      collect_captured_borrow_view_names(
        stmt.expr,
        aliases,
        shadowed,
        names,
      );
      return;

    case "break":
      if (stmt.value) {
        collect_captured_borrow_view_names(
          stmt.value,
          aliases,
          shadowed,
          names,
        );
      }
      return;
    case "continue":
    case "unsupported":
      return;
  }
}

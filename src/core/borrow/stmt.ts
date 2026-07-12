import type { CoreStmt } from "../ast.ts";
import {
  bind_collection_loop_item_owner_alias,
  bind_if_let_payload_owner_alias,
  canonical_owner_names,
  clear_borrow_alias,
  clone_borrow_aliases,
  clone_branch_borrow_aliases,
  merge_optional_branch_borrow_aliases,
  merge_required_branch_borrow_aliases,
} from "./aliases.ts";
import { check_borrowed_owner_barriers } from "./barrier.ts";
import { scan_borrow_binding_value } from "./binding.ts";
import { core_stmt_definitely_exits_sequence } from "./control.ts";
import { record_borrow_expr_with_scan, type ScanBorrowExpr } from "./record.ts";
import { add_scope } from "./scope.ts";
import type {
  CoreBorrowAliases,
  CoreBorrowHooks,
  CoreBorrowState,
  CoreBorrowUse,
} from "./types.ts";
import type { CoreBorrowViewResultScanner } from "./view_result.ts";

type CoreBorrowStmtScanner<ctx> = {
  scan_expr: ScanBorrowExpr<ctx>;
};

export function scan_borrow_stmts_with_expr<ctx>(
  statements: CoreStmt[],
  ctx: ctx,
  hooks: CoreBorrowHooks<ctx>,
  parent: string,
  state: CoreBorrowState,
  final_use: CoreBorrowUse,
  aliases: CoreBorrowAliases,
  scan_expr: ScanBorrowExpr<ctx>,
): void {
  scan_borrow_stmts_with_scanner(
    statements,
    ctx,
    hooks,
    parent,
    state,
    final_use,
    aliases,
    { scan_expr },
  );
}

function scan_borrow_stmts_with_scanner<ctx>(
  statements: CoreStmt[],
  ctx: ctx,
  hooks: CoreBorrowHooks<ctx>,
  parent: string,
  state: CoreBorrowState,
  final_use: CoreBorrowUse,
  aliases: CoreBorrowAliases,
  scanner: CoreBorrowStmtScanner<ctx>,
): void {
  for (let index = 0; index < statements.length; index += 1) {
    const stmt = statements[index];

    if (!stmt) {
      throw new Error("Missing core borrow statement " + index.toString());
    }

    if (index + 1 >= statements.length) {
      scan_borrow_stmt_with_scanner(
        stmt,
        ctx,
        hooks,
        parent,
        state,
        final_use,
        aliases,
        scanner,
      );
    } else {
      scan_borrow_stmt_with_scanner(
        stmt,
        ctx,
        hooks,
        parent,
        state,
        "bounded",
        aliases,
        scanner,
      );
    }

    if (core_stmt_definitely_exits_sequence(stmt)) {
      return;
    }
  }
}

function scan_borrow_stmt_with_scanner<ctx>(
  stmt: CoreStmt,
  ctx: ctx,
  hooks: CoreBorrowHooks<ctx>,
  parent: string,
  state: CoreBorrowState,
  use: CoreBorrowUse,
  aliases: CoreBorrowAliases,
  scanner: CoreBorrowStmtScanner<ctx>,
): void {
  switch (stmt.tag) {
    case "bind":
      if (hooks.static_value(stmt.name, ctx)) {
        return;
      }

      aliases.known.add(stmt.name);
      check_borrowed_owner_barriers(
        canonical_owner_names(stmt.name, aliases),
        "assign",
        parent,
        state,
        stmt,
      );
      scan_borrow_binding_value(
        stmt.name,
        stmt.annotation,
        stmt.value,
        ctx,
        hooks,
        parent,
        state,
        aliases,
        borrow_view_scanner(scanner),
      );
      return;

    case "assign":
      aliases.known.add(stmt.name);
      aliases.assigned.add(stmt.name);
      check_borrowed_owner_barriers(
        canonical_owner_names(stmt.name, aliases),
        "assign",
        parent,
        state,
        stmt,
      );
      scan_borrow_binding_value(
        stmt.name,
        undefined,
        stmt.value,
        ctx,
        hooks,
        parent,
        state,
        aliases,
        borrow_view_scanner(scanner),
      );
      return;

    case "index_assign":
      check_borrowed_owner_barriers(
        canonical_owner_names(stmt.name, aliases),
        "index_assign",
        parent,
        state,
        stmt,
      );
      scanner.scan_expr(
        stmt.index,
        ctx,
        hooks,
        parent,
        state,
        "bounded",
        aliases,
      );
      scanner.scan_expr(
        stmt.value,
        ctx,
        hooks,
        parent,
        state,
        "escaping",
        aliases,
      );
      return;

    case "range_loop": {
      scanner.scan_expr(
        stmt.start,
        ctx,
        hooks,
        parent,
        state,
        "bounded",
        aliases,
      );
      scanner.scan_expr(
        stmt.end,
        ctx,
        hooks,
        parent,
        state,
        "bounded",
        aliases,
      );
      scanner.scan_expr(
        stmt.step,
        ctx,
        hooks,
        parent,
        state,
        "bounded",
        aliases,
      );
      const scope = add_scope(state, "loop", undefined, parent);
      const body_aliases = clone_borrow_aliases(aliases);
      clear_borrow_alias(stmt.index, body_aliases);
      scan_borrow_stmts_with_scanner(
        stmt.body,
        ctx,
        hooks,
        scope.id,
        state,
        "bounded",
        body_aliases,
        scanner,
      );
      merge_optional_branch_borrow_aliases(
        aliases,
        body_aliases,
        parent,
        state,
      );
      return;
    }

    case "collection_loop": {
      scanner.scan_expr(
        stmt.collection,
        ctx,
        hooks,
        parent,
        state,
        "bounded",
        aliases,
      );
      const scope = add_scope(state, "loop", undefined, parent);
      const body_aliases = clone_borrow_aliases(aliases);
      clear_borrow_alias(stmt.item, body_aliases);
      bind_collection_loop_item_owner_alias(
        stmt.item,
        stmt.collection,
        scope.id,
        ctx,
        hooks,
        body_aliases,
      );

      if (stmt.index) {
        clear_borrow_alias(stmt.index, body_aliases);
      }

      scan_borrow_stmts_with_scanner(
        stmt.body,
        ctx,
        hooks,
        scope.id,
        state,
        "bounded",
        body_aliases,
        scanner,
      );
      merge_optional_branch_borrow_aliases(
        aliases,
        body_aliases,
        parent,
        state,
      );
      return;
    }

    case "if_stmt": {
      scanner.scan_expr(
        stmt.cond,
        ctx,
        hooks,
        parent,
        state,
        "bounded",
        aliases,
      );
      const scope = add_scope(state, "block", undefined, parent);
      const body_aliases = clone_branch_borrow_aliases(aliases);

      scan_borrow_stmts_with_scanner(
        stmt.body,
        ctx,
        hooks,
        scope.id,
        state,
        "bounded",
        body_aliases,
        scanner,
      );
      merge_optional_branch_borrow_aliases(
        aliases,
        body_aliases,
        parent,
        state,
      );
      return;
    }

    case "if_else_stmt": {
      scanner.scan_expr(
        stmt.cond,
        ctx,
        hooks,
        parent,
        state,
        "bounded",
        aliases,
      );
      const then_scope = add_scope(state, "block", undefined, parent);
      const then_aliases = clone_branch_borrow_aliases(aliases);
      scan_borrow_stmts_with_scanner(
        stmt.then_body,
        ctx,
        hooks,
        then_scope.id,
        state,
        use,
        then_aliases,
        scanner,
      );
      const else_scope = add_scope(state, "block", undefined, parent);
      const else_aliases = clone_branch_borrow_aliases(aliases);
      scan_borrow_stmts_with_scanner(
        stmt.else_body,
        ctx,
        hooks,
        else_scope.id,
        state,
        use,
        else_aliases,
        scanner,
      );
      merge_required_branch_borrow_aliases(
        aliases,
        then_aliases,
        else_aliases,
        parent,
        state,
      );
      return;
    }

    case "if_let_stmt": {
      scanner.scan_expr(
        stmt.target,
        ctx,
        hooks,
        parent,
        state,
        "bounded",
        aliases,
      );
      const scope = add_scope(state, "block", undefined, parent);
      const body_aliases = clone_borrow_aliases(aliases);

      if (stmt.value_name) {
        bind_if_let_payload_owner_alias(
          stmt.case_name,
          stmt.value_name,
          stmt.target,
          ctx,
          hooks,
          body_aliases,
        );
      }

      scan_borrow_stmts_with_scanner(
        stmt.body,
        ctx,
        hooks,
        scope.id,
        state,
        "bounded",
        body_aliases,
        scanner,
      );
      merge_optional_branch_borrow_aliases(
        aliases,
        body_aliases,
        parent,
        state,
      );
      return;
    }

    case "type_check":
      scanner.scan_expr(
        stmt.target,
        ctx,
        hooks,
        parent,
        state,
        "bounded",
        aliases,
      );
      return;

    case "return":
      scanner.scan_expr(
        stmt.value,
        ctx,
        hooks,
        parent,
        state,
        "escaping",
        aliases,
      );
      return;

    case "expr":
      scanner.scan_expr(stmt.expr, ctx, hooks, parent, state, use, aliases);
      return;

    case "break":
    case "continue":
    case "unsupported":
      return;
  }
}

function borrow_view_scanner<ctx>(
  scanner: CoreBorrowStmtScanner<ctx>,
): CoreBorrowViewResultScanner<ctx> {
  return {
    scan_expr: scanner.scan_expr,
    scan_stmt: (stmt, ctx, hooks, parent, state, use, aliases) =>
      scan_borrow_stmt_with_scanner(
        stmt,
        ctx,
        hooks,
        parent,
        state,
        use,
        aliases,
        scanner,
      ),
    record_borrow: (expr, ctx, hooks, parent, state, use, aliases) =>
      record_borrow_expr_with_scan(
        expr,
        ctx,
        hooks,
        parent,
        state,
        use,
        aliases,
        scanner.scan_expr,
      ),
  };
}

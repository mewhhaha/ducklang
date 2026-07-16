import type { CoreExpr, CoreStmt } from "../ast.ts";
import {
  bind_if_let_payload_owner_alias,
  clone_borrow_aliases,
  promote_stored_borrow_view,
  stored_borrow_view_for_value,
} from "./aliases.ts";
import { add_scope } from "./scope.ts";
import { core_stmt_definitely_exits_sequence } from "./control.ts";
import type {
  CoreBorrowAliases,
  CoreBorrowHooks,
  CoreBorrowState,
  CoreBorrowUse,
  CoreRecordedBorrow,
  CoreStoredBorrowView,
  CoreStoredBorrowViewResult,
} from "./types.ts";

export type CoreBorrowViewResultScanner<ctx> = {
  scan_expr: (
    expr: CoreExpr,
    ctx: ctx,
    hooks: CoreBorrowHooks<ctx>,
    parent: string,
    state: CoreBorrowState,
    use: CoreBorrowUse,
    aliases: CoreBorrowAliases,
  ) => void;
  scan_stmt: (
    stmt: CoreStmt,
    ctx: ctx,
    hooks: CoreBorrowHooks<ctx>,
    parent: string,
    state: CoreBorrowState,
    use: CoreBorrowUse,
    aliases: CoreBorrowAliases,
  ) => void;
  record_borrow: (
    expr: Extract<CoreExpr, { tag: "borrow" }>,
    ctx: ctx,
    hooks: CoreBorrowHooks<ctx>,
    parent: string,
    state: CoreBorrowState,
    use: CoreBorrowUse,
    aliases: CoreBorrowAliases,
  ) => CoreRecordedBorrow;
};

export function stored_borrow_view_result_for_value<ctx>(
  value: CoreExpr,
  ctx: ctx,
  hooks: CoreBorrowHooks<ctx>,
  parent: string,
  state: CoreBorrowState,
  aliases: CoreBorrowAliases,
  scanner: CoreBorrowViewResultScanner<ctx>,
): CoreStoredBorrowViewResult {
  if (value.tag === "block") {
    return stored_borrow_view_result_for_block(
      value,
      ctx,
      hooks,
      parent,
      state,
      aliases,
      scanner,
    );
  }

  const stored = stored_borrow_view_for_value(value, aliases);

  if (stored) {
    return {
      view: stored,
      scanned: false,
    };
  }

  if (value.tag === "borrow") {
    const recorded = scanner.record_borrow(
      value,
      ctx,
      hooks,
      parent,
      state,
      "bounded",
      aliases,
    );

    if (
      recorded.owners.length > 0 && recorded.ownership.tag === "unique_heap" &&
      recorded.decision.tag === "allowed"
    ) {
      return {
        view: {
          owners: recorded.owners,
          borrow_id: recorded.id,
          scope: recorded.scope,
          iteration_scope: recorded.iteration_scope,
          ownership: recorded.ownership,
        },
        scanned: true,
      };
    }

    return {
      view: undefined,
      scanned: true,
    };
  }

  if (value.tag === "if") {
    scanner.scan_expr(
      value.cond,
      ctx,
      hooks,
      parent,
      state,
      "bounded",
      aliases,
    );
    const views: CoreStoredBorrowView[] = [];
    collect_stored_borrow_view_result(
      value.then_branch,
      ctx,
      hooks,
      parent,
      state,
      aliases,
      scanner,
      views,
    );
    collect_stored_borrow_view_result(
      value.else_branch,
      ctx,
      hooks,
      parent,
      state,
      aliases,
      scanner,
      views,
    );

    if (views.length > 0) {
      return {
        view: merge_stored_borrow_views(views, parent, state),
        scanned: true,
      };
    }

    return {
      view: undefined,
      scanned: true,
    };
  }

  if (value.tag === "if_let") {
    scanner.scan_expr(
      value.target,
      ctx,
      hooks,
      parent,
      state,
      "bounded",
      aliases,
    );
    const views: CoreStoredBorrowView[] = [];
    const then_aliases = clone_borrow_aliases(aliases);

    if (value.value_name) {
      bind_if_let_payload_owner_alias(
        value.case_name,
        value.value_name,
        value.target,
        ctx,
        hooks,
        then_aliases,
      );
    }

    collect_stored_borrow_view_result(
      value.then_branch,
      ctx,
      hooks,
      parent,
      state,
      then_aliases,
      scanner,
      views,
    );
    collect_stored_borrow_view_result(
      value.else_branch,
      ctx,
      hooks,
      parent,
      state,
      aliases,
      scanner,
      views,
    );

    if (views.length > 0) {
      return {
        view: merge_stored_borrow_views(views, parent, state),
        scanned: true,
      };
    }

    return {
      view: undefined,
      scanned: true,
    };
  }

  return {
    view: undefined,
    scanned: false,
  };
}

function stored_borrow_view_result_for_block<ctx>(
  value: Extract<CoreExpr, { tag: "block" }>,
  ctx: ctx,
  hooks: CoreBorrowHooks<ctx>,
  parent: string,
  state: CoreBorrowState,
  aliases: CoreBorrowAliases,
  scanner: CoreBorrowViewResultScanner<ctx>,
): CoreStoredBorrowViewResult {
  const scope = add_scope(state, "block", undefined, parent);
  const block_aliases = clone_borrow_aliases(aliases);
  let block_ctx = ctx;

  if (hooks.block_ctx && hooks.collect_stmt_locals) {
    block_ctx = hooks.block_ctx(ctx);
  }

  const result = scan_borrow_block_prefix_for_result(
    value.statements,
    block_ctx,
    hooks,
    scope.id,
    state,
    block_aliases,
    scanner,
  );

  if (!result) {
    return {
      view: undefined,
      scanned: true,
    };
  }

  const result_view = stored_borrow_view_result_for_value(
    result,
    block_ctx,
    hooks,
    scope.id,
    state,
    block_aliases,
    scanner,
  );

  if (result_view.view) {
    return {
      view: promote_stored_borrow_view(result_view.view, parent, state),
      scanned: true,
    };
  }

  if (result_view.scanned) {
    return {
      view: undefined,
      scanned: true,
    };
  }

  scanner.scan_expr(
    result,
    block_ctx,
    hooks,
    scope.id,
    state,
    "bounded",
    block_aliases,
  );
  return {
    view: undefined,
    scanned: true,
  };
}

function scan_borrow_block_prefix_for_result<ctx>(
  statements: CoreStmt[],
  ctx: ctx,
  hooks: CoreBorrowHooks<ctx>,
  parent: string,
  state: CoreBorrowState,
  aliases: CoreBorrowAliases,
  scanner: CoreBorrowViewResultScanner<ctx>,
): CoreExpr | undefined {
  if (statements.length === 0) {
    return undefined;
  }

  for (let index = 0; index + 1 < statements.length; index += 1) {
    const stmt = statements[index];

    if (!stmt) {
      throw new Error("Missing core borrow block statement " + index);
    }

    scanner.scan_stmt(stmt, ctx, hooks, parent, state, "bounded", aliases);

    if (core_stmt_definitely_exits_sequence(stmt)) {
      return undefined;
    }

    if (hooks.collect_stmt_locals) {
      hooks.collect_stmt_locals(stmt, ctx);
    }
  }

  const final_stmt = statements[statements.length - 1];

  if (!final_stmt) {
    throw new Error("Missing core borrow block final statement");
  }

  if (final_stmt.tag === "expr") {
    return final_stmt.expr;
  }

  if (final_stmt.tag === "return") {
    return final_stmt.value;
  }

  scanner.scan_stmt(final_stmt, ctx, hooks, parent, state, "bounded", aliases);
  return undefined;
}

function collect_stored_borrow_view_result<ctx>(
  value: CoreExpr,
  ctx: ctx,
  hooks: CoreBorrowHooks<ctx>,
  parent: string,
  state: CoreBorrowState,
  aliases: CoreBorrowAliases,
  scanner: CoreBorrowViewResultScanner<ctx>,
  views: CoreStoredBorrowView[],
): void {
  const result = stored_borrow_view_result_for_value(
    value,
    ctx,
    hooks,
    parent,
    state,
    aliases,
    scanner,
  );

  if (result.view) {
    views.push(result.view);
    return;
  }

  if (result.scanned) {
    return;
  }

  scanner.scan_expr(value, ctx, hooks, parent, state, "bounded", aliases);
}

function merge_stored_borrow_views(
  views: CoreStoredBorrowView[],
  scope: string,
  state: CoreBorrowState,
): CoreStoredBorrowView {
  const first = views[0];

  if (!first) {
    throw new Error("Missing stored borrow view to merge");
  }

  const owners: string[] = [];
  let ownership = first.ownership;

  for (const view of views) {
    const promoted = promote_stored_borrow_view(view, scope, state);

    for (const owner of promoted.owners) {
      if (owners.includes(owner)) {
        continue;
      }

      owners.push(owner);
    }

    if (promoted.ownership.tag === "unique_heap") {
      ownership = promoted.ownership;
    }
  }

  return {
    owners,
    borrow_id: first.borrow_id,
    scope,
    iteration_scope: first.iteration_scope,
    ownership,
  };
}

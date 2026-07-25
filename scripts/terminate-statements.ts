/**
 * Codemod for the mandatory-terminator migration.
 *
 * Adds a `;` to every statement that lacks one, and wraps a block's trailing
 * expression in `return … ;`. Edits are pure text insertions at spans recorded
 * by the parser, so layout, comments and blank lines survive untouched — the
 * `duck fmt` CLI cannot do this because it reflows tokens without knowing what
 * a statement is.
 *
 *   deno run --allow-read --allow-write scripts/terminate-statements.ts <path…>
 *   deno run --allow-read scripts/terminate-statements.ts --check <path…>
 */
import { parse_source_with_diagnostics } from "../src/frontend/parser.ts";
import type { FrontExpr, Stmt } from "../src/frontend/ast.ts";
import { has_source_span, source_span } from "../src/source_span.ts";

type Insertion = { at: number; text: string };
type Span = { start: number; end: number };

/** Statement kinds that already carry their own terminator in source. */
function is_self_terminating(stmt: Stmt): boolean {
  return stmt.tag === "bind" || stmt.tag === "return" ||
    stmt.tag === "import" || stmt.tag === "host_import" ||
    stmt.tag === "for_range" || stmt.tag === "for_collection" ||
    stmt.tag === "break" || stmt.tag === "continue";
}

function block_statements(expr: FrontExpr): Stmt[] | undefined {
  if (expr.tag === "block") {
    return expr.statements;
  }

  return undefined;
}

function collect_from_expr(
  expr: FrontExpr,
  out: Insertion[],
  value_block: boolean,
  parent: Span | undefined,
): void {
  const statements = block_statements(expr);

  if (statements !== undefined) {
    collect_from_block(statements, out, value_block, parent);
    return;
  }

  if (expr.tag === "lam" || expr.tag === "rec") {
    // A lambda body is a value block whatever encloses it, and it starts a
    // fresh span lineage.
    collect_from_expr(expr.body, out, true, undefined);
    return;
  }

  if (expr.tag === "loop") {
    collect_from_block(expr.body, out, false, parent);
    return;
  }

  if (expr.tag === "match") {
    collect_from_expr(expr.target, out, false, parent);

    // An arm yields a value only when the match itself does. A refutable
    // `for` pattern desugars into a match whose arms are not value blocks.
    for (const arm of expr.arms) {
      collect_from_expr(arm.body, out, value_block, parent);
    }

    return;
  }

  if (expr.tag === "app") {
    collect_from_expr(expr.func, out, false, parent);

    for (const arg of expr.args) {
      collect_from_expr(arg, out, false, parent);
    }
  }
}

/** Statement forms that carry nested statement lists. */
function collect_nested_statements(
  stmt: Stmt,
  out: Insertion[],
  parent: Span | undefined,
): void {
  if (
    stmt.tag === "for_range" || stmt.tag === "for_collection" ||
    stmt.tag === "if_stmt" || stmt.tag === "if_let_stmt"
  ) {
    collect_from_block(stmt.body, out, false, parent);
  }
}

/**
 * `value_block` marks a block whose last expression is its value — a lambda
 * body, a block expression, a match arm. A loop, `for` or statement-position
 * `if` body produces nothing, so its last statement is just a statement.
 */
function collect_from_block(
  statements: Stmt[],
  out: Insertion[],
  value_block: boolean,
  parent: Span | undefined,
): void {
  for (let index = 0; index < statements.length; index += 1) {
    const stmt = statements[index];

    if (stmt === undefined || !has_source_span(stmt)) {
      continue;
    }

    const span = source_span(stmt);
    const last = index === statements.length - 1;

    // A trailing expression is the block's value, so it becomes an explicit
    // return. Any other unterminated statement just gains its terminator.
    // Desugared nodes carry the span of the surface construct they came from —
    // a refutable `for` pattern becomes a match reporting the `for`'s own span.
    // Editing from those would place text at the enclosing construct's edges,
    // so only a statement with a span of its own may be edited.
    const derived = parent !== undefined && span.start === parent.start &&
      span.end === parent.end;

    if (derived) {
      collect_nested_statements(stmt, out, span);

      if (stmt.tag === "expr") {
        collect_from_expr(stmt.expr, out, value_block && last, span);
      }

      continue;
    }

    if (value_block && last && stmt.tag === "expr" && stmt.effectful !== true) {
      out.push({ at: span.start, text: "return " });
      out.push({ at: span.end, text: ";" });
    } else if (!is_self_terminating(stmt)) {
      out.push({ at: span.end, text: ";" });
    }

    collect_nested_statements(stmt, out, span);

    if (stmt.tag === "expr") {
      collect_from_expr(stmt.expr, out, value_block && last, span);
    }

    if (stmt.tag === "bind" && stmt.value !== undefined) {
      collect_from_expr(stmt.value, out, true, undefined);
    }
  }
}

export function terminate(text: string): string | undefined {
  const parsed = parse_source_with_diagnostics(text);

  if (parsed.diagnostics.length > 0) {
    return undefined;
  }

  const insertions: Insertion[] = [];
  collect_from_block(parsed.source.statements, insertions, true, undefined);

  if (insertions.length === 0) {
    return text;
  }

  insertions.sort((left, right) => right.at - left.at);
  let output = text;

  for (const insertion of insertions) {
    output = output.slice(0, insertion.at) + insertion.text +
      output.slice(insertion.at);
  }

  return output;
}

if (import.meta.main) {
  const check = Deno.args.includes("--check");
  const paths = Deno.args.filter((arg) => !arg.startsWith("--"));
  let changed = 0;
  let skipped = 0;

  for (const path of paths) {
    const text = await Deno.readTextFile(path);
    const output = terminate(text);

    if (output === undefined) {
      console.error("skipped (does not parse): " + path);
      skipped += 1;
      continue;
    }

    if (output === text) {
      continue;
    }

    changed += 1;

    if (check) {
      console.log(path);
      continue;
    }

    await Deno.writeTextFile(path, output);
  }

  console.error(
    "changed " + changed.toString() + ", skipped " + skipped.toString(),
  );
}

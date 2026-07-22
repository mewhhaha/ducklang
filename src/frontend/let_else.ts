import { expect } from "../expect.ts";
import type { FrontExpr, Source, Stmt } from "./ast.ts";
import { invalidate_source_facts } from "./source_facts.ts";
import { derive_missing_source_spans, source_span } from "./syntax.ts";

type RewriteState = {
  changed: boolean;
};

export function elaborate_front_let_else(source: Source): Source {
  const seen = new WeakSet<object>();
  const state: RewriteState = { changed: false };

  for (const declaration of source.declarations || []) {
    rewrite_nested_statement_lists(declaration, seen, state);
  }

  const statements = rewrite_statements(source.statements, seen, state);

  if (!state.changed) {
    return source;
  }

  invalidate_source_facts(source);

  return {
    ...source,
    statements,
  };
}

function rewrite_statements(
  statements: Stmt[],
  seen: WeakSet<object>,
  state: RewriteState,
): Stmt[] {
  const rewritten: Stmt[] = [];

  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    expect(statement, "Missing let-else statement");
    rewrite_nested_statement_lists(statement, seen, state);

    if (statement.tag !== "bind" || statement.else_branch === undefined) {
      rewritten.push(statement);
      continue;
    }

    expect(statement.kind === "let", "Let-else requires a let binding");
    expect(!statement.is_recursive, "Let-else cannot be recursive");
    expect(statement.mutual === undefined, "Let-else cannot be mutual");
    const pattern = statement.pattern;
    expect(pattern !== undefined, "Let-else requires a source pattern");
    const remaining = rewrite_statements(
      statements.slice(index + 1),
      seen,
      state,
    );
    let simple_union_case:
      | { case_name: string; value_name: string | undefined }
      | undefined;

    if (pattern.tag === "union_case") {
      if (pattern.value === undefined || pattern.value.tag === "unit") {
        simple_union_case = {
          case_name: pattern.name,
          value_name: undefined,
        };
      } else if (
        pattern.value.tag === "binding" &&
        pattern.value.mode === "default" &&
        pattern.value.annotation === undefined &&
        pattern.value.type_annotation === undefined &&
        !pattern.value.is_variadic
      ) {
        simple_union_case = {
          case_name: pattern.name,
          value_name: pattern.value.name,
        };
      }
    }

    let expr: FrontExpr;

    if (simple_union_case !== undefined) {
      expr = {
        tag: "if_let",
        case_name: simple_union_case.case_name,
        value_name: simple_union_case.value_name,
        target: statement.value,
        then_branch: { tag: "block", statements: remaining },
        else_branch: statement.else_branch,
      };
    } else {
      expr = {
        tag: "match",
        target: statement.value,
        arms: [{
          pattern,
          guard: undefined,
          body: { tag: "block", statements: remaining },
        }, {
          pattern: { tag: "wildcard", mode: "default" },
          guard: undefined,
          body: statement.else_branch,
        }],
      };
    }

    const replacement: Stmt = {
      tag: "expr",
      expr,
    };
    derive_missing_source_spans(replacement, source_span(statement));
    state.changed = true;
    rewritten.push(replacement);
    return rewritten;
  }

  return statements;
}

function rewrite_nested_statement_lists(
  value: unknown,
  seen: WeakSet<object>,
  state: RewriteState,
): void {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return;
  }

  if (value instanceof Map || value instanceof Set) {
    return;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      rewrite_nested_statement_lists(entry, seen, state);
    }
    return;
  }

  const node = value as Record<string, unknown>;

  if (node.tag === "block" && Array.isArray(node.statements)) {
    node.statements = rewrite_statements(
      node.statements as Stmt[],
      seen,
      state,
    );
  } else if (
    (node.tag === "loop" || node.tag === "for_range" ||
      node.tag === "for_collection" || node.tag === "if_stmt" ||
      node.tag === "if_let_stmt") && Array.isArray(node.body)
  ) {
    node.body = rewrite_statements(node.body as Stmt[], seen, state);
  }

  for (const [name, child] of Object.entries(node)) {
    if (
      (node.tag === "block" && name === "statements") ||
      ((node.tag === "loop" || node.tag === "for_range" ||
        node.tag === "for_collection" || node.tag === "if_stmt" ||
        node.tag === "if_let_stmt") && name === "body")
    ) {
      continue;
    }

    rewrite_nested_statement_lists(child, seen, state);
  }
}

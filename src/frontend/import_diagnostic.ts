import type { Source, Stmt } from "./ast.ts";
import { source_exports_name } from "./load.ts";
import { parse_source_with_diagnostics } from "./parser.ts";
import {
  source_diagnostic,
  type SourceDiagnostic,
} from "./semantic_diagnostic.ts";

export type SourceImportResolver = (uri: string) => string | undefined;

export function validate_source_imports(
  source: Source,
  uri: string,
  resolve_import: SourceImportResolver,
): SourceDiagnostic[] {
  const diagnostics: SourceDiagnostic[] = [];
  const visited = new Set<string>([uri]);

  for (const stmt of source.statements) {
    if (stmt.tag !== "import") {
      continue;
    }

    const diagnostic = validate_source_import(
      stmt,
      uri,
      resolve_import,
      stmt,
      [uri],
      visited,
    );

    if (diagnostic !== undefined) {
      diagnostics.push(diagnostic);
    }
  }

  return diagnostics;
}

function validate_source_import(
  stmt: Extract<Stmt, { tag: "import" }>,
  uri: string,
  resolve_import: SourceImportResolver,
  root_subject: Extract<Stmt, { tag: "import" }>,
  stack: string[],
  visited: Set<string>,
): SourceDiagnostic | undefined {
  let dependency_uri: string;

  try {
    dependency_uri = new URL(stmt.path, uri).href;
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }

    return source_diagnostic(
      "IX2505",
      "error",
      "Invalid import URI: " + stmt.path,
      root_subject,
    );
  }

  if (stack.includes(dependency_uri)) {
    return source_diagnostic(
      "IX2504",
      "error",
      "Circular import: " + [...stack, dependency_uri].join(" -> "),
      root_subject,
    );
  }

  const text = resolve_import(dependency_uri);

  if (text === undefined) {
    return source_diagnostic(
      "IX2502",
      "error",
      "Import dependency does not exist: " + stmt.path,
      root_subject,
    );
  }

  const dependency = parse_source_with_diagnostics(text);
  const parse_error = dependency.diagnostics[0];

  if (parse_error !== undefined) {
    return source_diagnostic(
      "IX2503",
      "error",
      "Imported source contains syntax errors: " + stmt.path,
      root_subject,
    );
  }

  if (!visited.has(dependency_uri)) {
    visited.add(dependency_uri);
    const dependency_stack = [...stack, dependency_uri];

    for (const dependency_stmt of dependency.source.statements) {
      if (dependency_stmt.tag !== "import") {
        continue;
      }

      const diagnostic = validate_source_import(
        dependency_stmt,
        dependency_uri,
        resolve_import,
        root_subject,
        dependency_stack,
        visited,
      );

      if (diagnostic !== undefined) {
        return diagnostic;
      }
    }
  }

  if (source_exports_name(dependency.source, stmt.name)) {
    return undefined;
  }

  return source_diagnostic(
    "IX2501",
    "error",
    "Import " + stmt.path + " does not export " + stmt.name,
    root_subject,
  );
}

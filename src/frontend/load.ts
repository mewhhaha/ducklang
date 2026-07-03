import type { Source as SourceNode, Stmt } from "./ast.ts";
import { parse_source } from "./parser.ts";

export function load_source(path: string): SourceNode {
  const url = source_file_url(path);
  return load_source_url(url, []);
}

function source_file_url(path: string): URL {
  try {
    const url = new URL(path);

    if (url.protocol === "file:") {
      return url;
    }

    throw new Error("Source path must be a file URL: " + path);
  } catch (_error) {
    let cwd = Deno.cwd();

    if (!cwd.endsWith("/")) {
      cwd += "/";
    }

    return new URL(path, "file://" + cwd);
  }
}

function load_source_url(url: URL, stack: string[]): SourceNode {
  if (stack.includes(url.href)) {
    throw new Error("Circular import: " + url.pathname);
  }

  const text = Deno.readTextFileSync(url);
  const source = parse_source(text);
  return resolve_imports(source, url, [...stack, url.href]);
}

function resolve_imports(
  source: SourceNode,
  base: URL,
  stack: string[],
): SourceNode {
  const statements: Stmt[] = [];

  for (const stmt of source.statements) {
    if (stmt.tag !== "import") {
      statements.push(stmt);
      continue;
    }

    const imported = load_source_url(new URL(stmt.path, base), stack);
    let found = false;

    for (const imported_stmt of imported.statements) {
      if (
        imported_stmt.tag !== "bind" && imported_stmt.tag !== "type_check" &&
        imported_stmt.tag !== "host_import"
      ) {
        throw new Error(
          "Import file can only expose top-level bindings: " + stmt.path,
        );
      }

      if (imported_stmt.tag === "bind" && imported_stmt.name === stmt.name) {
        found = true;
      }

      statements.push(imported_stmt);
    }

    if (!found) {
      throw new Error(
        "Import " + stmt.path + " does not export " + stmt.name,
      );
    }
  }

  return { tag: "program", statements };
}

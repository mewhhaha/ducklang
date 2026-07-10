import type { Source as SourceNode } from "./ast.ts";
import { ParserStmt } from "./parser_stmt.ts";
import { tokenize } from "./tokenize.ts";

export function parse_source(text: string): SourceNode {
  const parser = new ParserStmt(tokenize(text));
  return parser.parse_program();
}

// This intentionally lives outside the public frontend facade. Low-level
// backend tests use it to construct the legacy raw host boundary directly.
export function parse_source_with_host_imports_for_test(
  text: string,
): SourceNode {
  const parser = new ParserStmt(tokenize(text), true);
  return parser.parse_program();
}

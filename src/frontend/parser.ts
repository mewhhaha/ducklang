import type { Source as SourceNode } from "./ast.ts";
import { ParserStmt } from "./parser_stmt.ts";
import { tokenize } from "./tokenize.ts";

export function parse_source(text: string): SourceNode {
  const parser = new ParserStmt(tokenize(text));
  return parser.parse_program();
}

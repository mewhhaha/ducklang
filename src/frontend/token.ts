import type { SourceSpan } from "../source_span.ts";

export type TokenKind =
  | "name"
  | "number"
  | "string"
  | "character"
  | "template"
  | "template_start"
  | "template_text"
  | "template_interpolation_start"
  | "template_interpolation_end"
  | "template_end"
  | "symbol"
  | "newline"
  | "comment"
  | "eof";

export type Token = {
  kind: TokenKind;
  text: string;
  /** Exact source spelling, including quotes and escapes for literals. */
  raw: string;
  /** UTF-16 source offsets, with an exclusive end. */
  span: SourceSpan;
  line: number;
  column: number;
};

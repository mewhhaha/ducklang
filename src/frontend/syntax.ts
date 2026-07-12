import { expect } from "../expect.ts";
import type { Token } from "./ast.ts";

/** A half-open range of UTF-16 offsets in a JavaScript source string. */
export type SourceSpan = {
  start: number;
  end: number;
};

export type SourcePosition = {
  line: number;
  column: number;
};

export type SyntaxDiagnostic = {
  message: string;
  span: SourceSpan;
};

export type Trivia = {
  kind: "whitespace" | "comment";
  raw: string;
  span: SourceSpan;
  line: number;
  column: number;
};

export type SourcePiece =
  | { tag: "trivia"; trivia: Trivia }
  | { tag: "token"; token: Token }
  | {
    tag: "invalid";
    raw: string;
    span: SourceSpan;
    line: number;
    column: number;
    diagnostic: SyntaxDiagnostic;
  };

export type SourceSyntax = {
  text: string;
  pieces: SourcePiece[];
  diagnostics: SyntaxDiagnostic[];
  position_at(offset: number): SourcePosition;
};

const node_spans = new WeakMap<object, SourceSpan>();
const node_span_origins = new WeakMap<object, "concrete" | "derived">();
const node_syntaxes = new WeakMap<object, SourceSyntax>();

export function mark_source_span<node extends object>(
  value: node,
  span: SourceSpan,
): node {
  validate_span(span);
  node_spans.set(value, span);
  node_span_origins.set(value, "concrete");
  return value;
}

export function inherit_source_span<node extends object>(
  value: node,
  source: object,
): node {
  return derive_source_span(value, source_span(source));
}

export function derive_source_span<node extends object>(
  value: node,
  span: SourceSpan,
): node {
  validate_span(span);
  node_spans.set(value, span);
  node_span_origins.set(value, "derived");
  return value;
}

export function source_span(value: object): SourceSpan {
  const span = node_spans.get(value);
  expect(span !== undefined, "Missing source span");
  return span;
}

export function has_source_span(value: object): boolean {
  return node_spans.has(value);
}

export function source_span_origin(value: object): "concrete" | "derived" {
  const origin = node_span_origins.get(value);
  expect(origin !== undefined, "Missing source span origin");
  return origin;
}

export function has_concrete_source_span(value: object): boolean {
  return source_span_origin(value) === "concrete";
}

export function mark_source_syntax<node extends object>(
  root: node,
  syntax: SourceSyntax,
): node {
  node_syntaxes.set(root, syntax);
  return root;
}

export function source_syntax(root: object): SourceSyntax {
  const syntax = node_syntaxes.get(root);
  expect(syntax !== undefined, "Missing source syntax");
  return syntax;
}

/** Give synthetic parser objects an enclosing location without overwriting
 * the locations recorded for syntax that came directly from tokens. */
export function derive_missing_source_spans(
  value: object,
  enclosing: SourceSpan,
): void {
  const seen = new WeakSet<object>();

  const visit = (current: object, parent_span: SourceSpan): void => {
    if (seen.has(current)) {
      return;
    }

    seen.add(current);
    let current_span = parent_span;

    if (node_spans.has(current)) {
      current_span = source_span(current);
    } else {
      derive_source_span(current, parent_span);
    }

    for (const child of Object.values(current)) {
      if (child !== null && typeof child === "object") {
        if (Array.isArray(child)) {
          for (const entry of child) {
            if (entry !== null && typeof entry === "object") {
              visit(entry, current_span);
            }
          }
        } else {
          visit(child, current_span);
        }
      }
    }
  };

  visit(value, enclosing);
}

export function make_source_syntax(
  text: string,
  pieces: SourcePiece[],
  diagnostics: SyntaxDiagnostic[],
): SourceSyntax {
  return {
    text,
    pieces,
    diagnostics,
    position_at(offset: number): SourcePosition {
      expect(Number.isInteger(offset), "Source offset must be an integer");
      expect(offset >= 0, "Source offset must not be negative");
      expect(offset <= text.length, "Source offset is beyond source text");

      let line = 1;
      let column = 1;

      for (let index = 0; index < offset; index += 1) {
        if (text[index] === "\n") {
          line += 1;
          column = 1;
        } else {
          column += 1;
        }
      }

      return { line, column };
    },
  };
}

function validate_span(span: SourceSpan): void {
  expect(Number.isInteger(span.start), "Source span start must be an integer");
  expect(Number.isInteger(span.end), "Source span end must be an integer");
  expect(span.start >= 0, "Source span start must not be negative");
  expect(span.end >= span.start, "Source span end precedes start");
}

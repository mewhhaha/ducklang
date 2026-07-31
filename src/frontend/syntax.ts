import { expect } from "../expect.ts";
import {
  derive_source_span,
  has_source_span,
  mark_source_span,
  source_span,
  source_span_origin,
  type SourceSpan,
} from "../source_span.ts";
import type { Token } from "./token.ts";

export {
  derive_source_span,
  has_concrete_source_span,
  has_source_span,
  inherit_source_span,
  mark_source_span,
  source_span,
  source_span_origin,
} from "../source_span.ts";
export type { SourceSpan } from "../source_span.ts";

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

export function clone_source_tree<value extends object>(source: value): value {
  const cloned = structuredClone(source);
  const pending: [object, object][] = [[source, cloned]];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const pair = pending.pop();
    expect(pair !== undefined, "Source clone lost a pending syntax node");
    const source_node = pair[0];
    const target_node = pair[1];
    if (visited.has(source_node)) continue;
    visited.add(source_node);
    if (has_source_span(source_node)) {
      const span = source_span(source_node);
      if (source_span_origin(source_node) === "concrete") {
        mark_source_span(target_node, span);
      } else {
        derive_source_span(target_node, span);
      }
    }
    const target_fields = target_node as Record<string, unknown>;
    for (const [name, source_field] of Object.entries(source_node)) {
      const target_field = target_fields[name];
      if (
        source_field === null || typeof source_field !== "object" ||
        target_field === null || typeof target_field !== "object"
      ) {
        continue;
      }
      pending.push([source_field, target_field]);
    }
  }
  return cloned;
}

const node_syntaxes = new WeakMap<object, SourceSyntax>();

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

    if (has_source_span(current)) {
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

import { expect } from "../expect.ts";
import {
  has_source_span,
  mark_source_span,
  source_span,
} from "../source_span.ts";
import type { Source, Token, TokenKind } from "./ast.ts";
import { lower_baba_source } from "./baba_lower.ts";
import {
  type BabaParseResult,
  type BabaRecoveryInterval,
  parse_duck_source,
} from "./baba_parser.ts";
import { checked_value, diagnostics_of } from "./checked.ts";
import { decode_literal_escape } from "./literal.ts";
import { record_direct_node_name_sites } from "./name_site.ts";
import {
  make_source_syntax,
  mark_source_syntax,
  type SourcePiece,
  type SourceSyntax,
  type SyntaxDiagnostic,
  type Trivia,
} from "./syntax.ts";
import { source_tokens } from "./tokenize.ts";

export type ParseSourceResult = {
  baba: BabaParseResult;
  source: Source;
  diagnostics: SyntaxDiagnostic[];
  recovery_intervals: BabaRecoveryInterval[];
  syntax: SourceSyntax;
};

export function parse_baba_source(text: string): Source {
  const parsed = parse_baba_source_with_diagnostics(text);
  const diagnostic = parsed.diagnostics[0];

  if (diagnostic !== undefined) {
    throw new Error(diagnostic.message);
  }

  return parsed.source;
}

export function parse_baba_source_with_diagnostics(
  text: string,
): ParseSourceResult {
  const baba = parse_duck_source(text);
  const lowered = lower_baba_source(baba);
  const lowering_diagnostics = diagnostics_of(lowered).filter((diagnostic) => {
    return !baba.recovery_intervals.some((recovery) => {
      return recovery.skipped.start <= diagnostic.span.start &&
        diagnostic.span.end <= recovery.skipped.end;
    });
  }).map((diagnostic) => ({
    message: diagnostic.message,
    span: diagnostic.span,
  }));
  const diagnostics = ordered_diagnostics(
    baba.diagnostics,
    lowering_diagnostics,
  );
  let source = checked_value(lowered);

  if (source === undefined) {
    source = { tag: "program", statements: [] };
    mark_source_span(source, { start: 0, end: text.length });
  }

  const syntax = baba_source_syntax(baba, diagnostics);
  mark_source_syntax(source, syntax);
  record_baba_name_sites(source, syntax);
  return {
    baba,
    source,
    diagnostics,
    recovery_intervals: [...baba.recovery_intervals],
    syntax,
  };
}

function record_baba_name_sites(source: Source, syntax: SourceSyntax): void {
  const tokens = source_tokens(syntax);
  const seen = new WeakSet<object>();
  const pending: object[] = [source];

  while (pending.length > 0) {
    const owner = pending.pop();
    expect(owner !== undefined, "Baba name-site work disappeared");
    if (seen.has(owner)) {
      continue;
    }
    seen.add(owner);

    if (has_source_span(owner)) {
      const span = source_span(owner);
      let lower = 0;
      let upper = tokens.length;
      while (lower < upper) {
        const middle = Math.floor((lower + upper) / 2);
        const token = tokens[middle];
        expect(token !== undefined, "Baba source token search found a hole");
        if (token.span.start < span.start) {
          lower = middle + 1;
        } else {
          upper = middle;
        }
      }
      const owned_tokens: Token[] = [];
      for (let index = lower; index < tokens.length; index += 1) {
        const token = tokens[index];
        expect(token !== undefined, "Baba source token list contains a hole");
        if (token.span.end > span.end) {
          break;
        }
        owned_tokens.push(token);
      }
      record_direct_node_name_sites(owner, owned_tokens);
    }

    for (const child of Object.values(owner)) {
      if (child === null || typeof child !== "object") {
        continue;
      }
      if (Array.isArray(child)) {
        for (const entry of child) {
          if (entry !== null && typeof entry === "object") {
            pending.push(entry);
          }
        }
      } else {
        pending.push(child);
      }
    }
  }
}

export function baba_source_syntax(
  parsed: BabaParseResult,
  diagnostics: readonly SyntaxDiagnostic[] = parsed.diagnostics,
): SourceSyntax {
  const text = parsed.cst.text;
  const pieces: SourcePiece[] = [];
  let offset = 0;
  let line = 1;
  let column = 1;
  const template_interpolations: number[] = [];

  const advance = (raw: string): void => {
    for (const character of raw) {
      offset += character.length;
      if (character === "\n") {
        line += 1;
        column = 1;
      } else {
        column += character.length;
      }
    }
  };

  const add_gap = (end: number): void => {
    expect(end >= offset, "Baba token stream overlaps at offset " + end);

    while (offset < end) {
      const character = text[offset];
      expect(
        character === " " || character === "\t" || character === "\r" ||
          character === "\n",
        "Baba token stream omitted source text at offset " + offset.toString(),
      );
      const start = offset;
      const start_line = line;
      const start_column = column;

      if (character === "\n") {
        advance(character);
        pieces.push({
          tag: "token",
          token: {
            kind: "newline",
            text: "\n",
            raw: "\n",
            span: { start, end: offset },
            line: start_line,
            column: start_column,
          },
        });
        continue;
      }

      while (offset < end) {
        const whitespace = text[offset];
        if (
          whitespace !== " " && whitespace !== "\t" && whitespace !== "\r"
        ) {
          break;
        }
        advance(whitespace);
      }
      const trivia: Trivia = {
        kind: "whitespace",
        raw: text.slice(start, offset),
        span: { start, end: offset },
        line: start_line,
        column: start_column,
      };
      pieces.push({ tag: "trivia", trivia });
    }
  };

  for (const baba_token of parsed.tokens) {
    add_gap(baba_token.start);
    expect(
      baba_token.start === offset,
      "Baba token starts outside the reconstructed source position",
    );
    const start_line = line;
    const start_column = column;
    const raw = text.slice(baba_token.start, baba_token.end);
    expect(
      raw === baba_token.text,
      "Baba token text differs from its source span",
    );

    if (baba_token.kind === "comment") {
      const trivia: Trivia = {
        kind: "comment",
        raw,
        span: { start: baba_token.start, end: baba_token.end },
        line: start_line,
        column: start_column,
      };
      pieces.push({ tag: "trivia", trivia });
      advance(raw);
      continue;
    }

    if (baba_token.kind === "intrinsic_identifier") {
      const parts = raw.split(".");
      const first = parts[0];
      expect(
        first !== undefined && first.startsWith("@") && first.length > 1,
        "Baba intrinsic identifier is malformed",
      );
      let intrinsic_offset = baba_token.start;
      let intrinsic_column = start_column;
      pieces.push({
        tag: "token",
        token: {
          kind: "symbol",
          text: "@",
          raw: "@",
          span: { start: intrinsic_offset, end: intrinsic_offset + 1 },
          line: start_line,
          column: intrinsic_column,
        },
      });
      intrinsic_offset += 1;
      intrinsic_column += 1;

      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index];
        expect(
          part !== undefined && part.length > 0,
          "Baba intrinsic identifier has an empty segment",
        );
        let name = part;
        if (index === 0) {
          name = part.slice(1);
        } else {
          pieces.push({
            tag: "token",
            token: {
              kind: "symbol",
              text: ".",
              raw: ".",
              span: { start: intrinsic_offset, end: intrinsic_offset + 1 },
              line: start_line,
              column: intrinsic_column,
            },
          });
          intrinsic_offset += 1;
          intrinsic_column += 1;
        }
        pieces.push({
          tag: "token",
          token: {
            kind: "name",
            text: name,
            raw: name,
            span: {
              start: intrinsic_offset,
              end: intrinsic_offset + name.length,
            },
            line: start_line,
            column: intrinsic_column,
          },
        });
        intrinsic_offset += name.length;
        intrinsic_column += name.length;
      }
      expect(
        intrinsic_offset === baba_token.end,
        "Baba intrinsic identifier reconstruction changed its span",
      );
      advance(raw);
      continue;
    }

    let contextual_template_kind: TokenKind | undefined;
    if (baba_token.kind === "template_start") {
      template_interpolations.push(0);
    } else {
      const last_index = template_interpolations.length - 1;
      const interpolation = template_interpolations[last_index];
      if (raw === "`" && interpolation === 0) {
        contextual_template_kind = "template_end";
        template_interpolations.pop();
      } else if (raw === "{" && interpolation !== undefined) {
        if (interpolation === 0) {
          contextual_template_kind = "template_interpolation_start";
        }
        template_interpolations[last_index] = interpolation + 1;
      } else if (
        raw === "}" && interpolation !== undefined && interpolation > 0
      ) {
        const remaining = interpolation - 1;
        template_interpolations[last_index] = remaining;
        if (remaining === 0) {
          contextual_template_kind = "template_interpolation_end";
        }
      }
    }

    const token = source_token(
      baba_token.kind,
      raw,
      baba_token.start,
      baba_token.end,
      start_line,
      start_column,
    );
    if (contextual_template_kind !== undefined) {
      token.kind = contextual_template_kind;
    }
    pieces.push({ tag: "token", token });
    advance(raw);
  }

  add_gap(text.length);
  pieces.push({
    tag: "token",
    token: {
      kind: "eof",
      text: "",
      raw: "",
      span: { start: offset, end: offset },
      line,
      column,
    },
  });
  return make_source_syntax(text, pieces, [...diagnostics]);
}

function source_token(
  baba_kind: string,
  raw: string,
  start: number,
  end: number,
  line: number,
  column: number,
): Token {
  let kind: TokenKind = "symbol";
  let text = raw;

  if (baba_kind === "number") {
    kind = "number";
  } else if (baba_kind === "string") {
    kind = "string";
    const decoded: unknown = JSON.parse(raw);
    expect(typeof decoded === "string", "Baba string token did not decode");
    text = decoded;
  } else if (baba_kind === "character") {
    kind = "character";
    text = decoded_character(raw);
  } else if (baba_kind === "template_start") {
    kind = "template_start";
  } else if (baba_kind === "template_text") {
    kind = "template_text";
    text = decoded_template_text(raw);
  } else if (raw === ";") {
    kind = "newline";
    text = "\n";
  } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw)) {
    kind = "name";
  }

  return {
    kind,
    text,
    raw,
    span: { start, end },
    line,
    column,
  };
}

function decoded_template_text(raw: string): string {
  let value = "";

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    expect(character !== undefined, "Baba template text contains a hole");

    if (
      (character === "{" || character === "}") &&
      raw[index + 1] === character
    ) {
      value += character;
      index += 1;
      continue;
    }
    if (character !== "\\") {
      value += character;
      continue;
    }

    const escaped = raw[index + 1];
    expect(escaped !== undefined, "Baba template escape is incomplete");
    const decoded = decode_literal_escape(escaped, "`");
    expect(decoded !== undefined, "Baba template escape is unsupported");
    value += decoded;
    index += 1;
  }

  return value;
}

function decoded_character(raw: string): string {
  const quoted = '"' + raw.slice(1, raw.length - 1)
    .replaceAll("\\'", "'")
    .replaceAll('"', '\\"') +
    '"';
  const decoded: unknown = JSON.parse(quoted);
  expect(
    typeof decoded === "string",
    "Baba character token did not decode",
  );
  return decoded;
}

function ordered_diagnostics(
  parser: readonly SyntaxDiagnostic[],
  lowering: readonly SyntaxDiagnostic[],
): SyntaxDiagnostic[] {
  return [...parser, ...lowering].sort((left, right) => {
    if (left.span.start !== right.span.start) {
      return left.span.start - right.span.start;
    }

    return left.span.end - right.span.end;
  });
}

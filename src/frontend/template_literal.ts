import { decode_literal_escape } from "./literal.ts";

export type TemplateLiteralPart =
  | {
    tag: "text";
    value: string;
    raw: string;
    span: { start: number; end: number };
  }
  | {
    tag: "interpolation";
    source: string;
    span: { start: number; end: number };
  };

export type TemplateLiteralScan =
  | { ok: true; end: number; parts: TemplateLiteralPart[] }
  | {
    ok: false;
    end: number;
    message: string;
    span: { start: number; end: number };
  };

export function scan_template_literal(
  source: string,
  start: number,
): TemplateLiteralScan {
  if (source[start] !== "`") {
    throw new Error(
      "Template literal must start with a backtick at offset " +
        start.toString(),
    );
  }

  const parts: TemplateLiteralPart[] = [];
  let cursor = start + 1;
  let text_start = cursor;
  let text_value = "";
  let problem:
    | {
      message: string;
      span: { start: number; end: number };
    }
    | undefined;

  while (cursor < source.length) {
    const char = source[cursor];

    if (char === "`") {
      parts.push({
        tag: "text",
        value: text_value,
        raw: source.slice(text_start, cursor),
        span: { start: text_start, end: cursor },
      });
      cursor += 1;

      if (problem !== undefined) {
        return { ok: false, end: cursor, ...problem };
      }

      return { ok: true, end: cursor, parts };
    }

    if (char === "\\") {
      const escaped = source[cursor + 1];

      if (escaped === undefined) {
        return {
          ok: false,
          end: source.length,
          message: "Unterminated template literal escape",
          span: { start: cursor, end: source.length },
        };
      }

      const decoded = decode_literal_escape(escaped, "`");

      if (decoded === undefined) {
        if (problem === undefined) {
          problem = {
            message: "Unsupported template literal escape: \\" + escaped,
            span: { start: cursor, end: cursor + 2 },
          };
        }
      } else {
        text_value += decoded;
      }

      cursor += 2;
      continue;
    }

    if (char === "{" && source[cursor + 1] === "{") {
      text_value += "{";
      cursor += 2;
      continue;
    }

    if (char === "}") {
      if (source[cursor + 1] === "}") {
        text_value += "}";
        cursor += 2;
        continue;
      }

      if (problem === undefined) {
        problem = {
          message: "Unescaped `}` in template literal; write `}}`",
          span: { start: cursor, end: cursor + 1 },
        };
      }
      text_value += "}";
      cursor += 1;
      continue;
    }

    if (char !== "{") {
      text_value += char;
      cursor += 1;
      continue;
    }

    parts.push({
      tag: "text",
      value: text_value,
      raw: source.slice(text_start, cursor),
      span: { start: text_start, end: cursor },
    });
    const interpolation_start = cursor + 1;
    cursor = interpolation_start;
    let brace_depth = 1;

    while (cursor < source.length && brace_depth > 0) {
      const expression_char = source[cursor];

      if (
        expression_char === "/" && source[cursor + 1] === "/"
      ) {
        cursor += 2;
        while (cursor < source.length && source[cursor] !== "\n") {
          cursor += 1;
        }
        continue;
      }

      if (
        expression_char === "`"
      ) {
        const nested = scan_template_literal(source, cursor);
        cursor = nested.end;

        if (!nested.ok && problem === undefined) {
          problem = {
            message: nested.message,
            span: nested.span,
          };
        }
        continue;
      }

      if (expression_char === '"' || expression_char === "'") {
        const quote = expression_char;
        cursor += 1;

        while (cursor < source.length) {
          const literal_char = source[cursor];

          if (literal_char === "\\") {
            cursor += 2;
          } else {
            cursor += 1;
            if (literal_char === quote) {
              break;
            }
          }
        }
        continue;
      }

      if (expression_char === "{") {
        brace_depth += 1;
      } else if (expression_char === "}") {
        brace_depth -= 1;
      }
      cursor += 1;
    }

    if (brace_depth !== 0) {
      return {
        ok: false,
        end: source.length,
        message: "Unterminated template interpolation",
        span: { start: interpolation_start - 1, end: source.length },
      };
    }

    const interpolation_end = cursor - 1;
    const interpolation_source = source.slice(
      interpolation_start,
      interpolation_end,
    );

    if (
      interpolation_source.trim().length === 0 && problem === undefined
    ) {
      problem = {
        message: "Template interpolation requires an expression",
        span: { start: interpolation_start, end: interpolation_end },
      };
    }

    parts.push({
      tag: "interpolation",
      source: interpolation_source,
      span: { start: interpolation_start, end: interpolation_end },
    });
    text_start = cursor;
    text_value = "";
  }

  return {
    ok: false,
    end: source.length,
    message: "Unterminated template literal",
    span: { start, end: source.length },
  };
}

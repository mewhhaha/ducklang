import type { FrontExpr, Token } from "../frontend/ast.ts";
import { parse_source_with_diagnostics } from "../frontend/parser.ts";
import {
  has_source_span,
  source_span,
  type SourceSyntax,
} from "../frontend/syntax.ts";
import { scan_source, source_tokens } from "../frontend/tokenize.ts";

// The formatter is deliberately biased: it re-emits the comment-preserving
// token stream with fixed spacing, two-space bracket indentation, collapsed
// blank runs, canonical string escapes, and a 100-column layout budget. Wide
// delimited expressions use one entry per line; other expressions break only
// at existing whitespace boundaries. The token order (and therefore the
// parsed program) is unchanged apart from redundant atomic-call parentheses.
// Statement semicolons are retained as line terminators, while semicolons
// inside brackets remain fixed-array separators.

const maximum_line_width = 100;

const keywords = new Set([
  "borrow",
  "break",
  "by",
  "comptime",
  "const",
  "continue",
  "declare",
  "dup",
  "effect",
  "else",
  "for",
  "freeze",
  "from",
  "handler",
  "if",
  "import",
  "in",
  "is",
  "let",
  "loop",
  "module",
  "rec",
  "return",
  "scalar",
  "scratch",
  "struct",
  "try",
  "type",
  "union",
  "where",
  "with",
]);

const openers = new Set(["{", "(", "["]);
const closers = new Set(["}", ")", "]"]);
const prefix_symbols = new Set(["!", "#", "@", "`"]);
// `&` and `\` are prefix sigils in value position but binary operators in
// type expressions such as `(Value :- Text) :& Int`; position decides.
const positional_symbols = new Set(["&", "\\"]);
const spaced_symbols = new Set([
  "=",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "=>",
  "->",
  "<-",
  ":=",
  "::",
  "+",
  "*",
  "/",
  "%",
  "|",
]);

type FormatToken = Token & {
  continuation?: boolean;
  row_open?: boolean;
  row_close?: boolean;
};

type Bracket = {
  open_indent: number;
  body_indent: number;
};

export function format_text(text: string): string {
  return format_syntax(scan_source(text));
}

export function format_syntax(syntax: SourceSyntax): string {
  const diagnostic = syntax.diagnostics[0];

  if (diagnostic !== undefined) {
    throw new Error(diagnostic.message);
  }

  const omitted_parentheses = redundant_unary_call_parentheses(syntax.text);
  const tokens = mark_effect_rows(
    source_tokens(syntax, { comments: true }).filter((token) => {
      return !omitted_parentheses.has(token.span.start);
    }),
  );
  const lines = join_continuation_lines(split_lines(tokens));
  const parts: string[] = [];
  const brackets: Bracket[] = [];
  let previous_blank = true;
  let previous_opened = false;
  let previous_continuation = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line === undefined || line.length === 0) {
      // A blank line: keep at most one, never at the start of the file,
      // never right after an opening line, and never right before a closer.
      const next = next_content_line(lines, index);

      if (previous_blank || previous_opened || next === undefined) {
        continue;
      }

      const first = next[0];

      if (first?.kind === "symbol" && closers.has(first.text)) {
        continue;
      }

      parts.push("");
      previous_blank = true;
      continue;
    }

    // A line that starts by closing a bracket aligns with the line that
    // opened it; otherwise it sits inside the innermost open bracket. All
    // brackets opened on one line share a single extra indent level.
    const enclosing = brackets[brackets.length - 1];
    let indent = 0;

    if (enclosing !== undefined) {
      indent = enclosing.body_indent;
    }

    if (line_starts_with_closer(line) && enclosing !== undefined) {
      indent = enclosing.open_indent;
    }

    const alternative = starts_with_alternative(line);

    if (previous_continuation && !alternative) {
      indent += 1;
    }

    if (alternative && enclosing === undefined) {
      indent += 1;
    }

    if (
      line[0]?.continuation === true && enclosing === undefined &&
      !previous_continuation &&
      !line_starts_with_closer(line)
    ) {
      indent += 1;
    }

    const rendered = render_line(line);
    const available_width = maximum_line_width - indent * 2;

    if (rendered.length > available_width) {
      const expanded = expand_delimited_entries(line, available_width);

      if (expanded !== undefined) {
        lines.splice(index, 1, ...expanded);
        index -= 1;
        continue;
      }

      const wrapped_definition = wrap_definition(line);

      if (wrapped_definition !== undefined) {
        lines.splice(index, 1, ...wrapped_definition);
        index -= 1;
        continue;
      }

      const wrapped = wrap_at_whitespace(line, available_width);

      if (wrapped !== undefined) {
        lines.splice(index, 1, ...wrapped);
        index -= 1;
        continue;
      }
    }

    parts.push("  ".repeat(indent) + rendered);

    for (const token of line) {
      if (token.kind !== "symbol") {
        continue;
      }

      if (openers.has(token.text)) {
        brackets.push({ open_indent: indent, body_indent: indent + 1 });
      } else if (closers.has(token.text)) {
        brackets.pop();
      }
    }

    previous_blank = false;
    const last = line[line.length - 1];
    previous_opened = last?.kind === "symbol" && openers.has(last.text);
    previous_continuation = last?.kind === "symbol" &&
      (last.text === "=" || last.text === "->" || last.text === "=>");
  }

  return parts.join("\n") + "\n";
}

function redundant_unary_call_parentheses(text: string): Set<number> {
  const omitted = new Set<number>();
  const parsed = parse_source_with_diagnostics(text);

  if (parsed.diagnostics.length > 0) {
    return omitted;
  }

  const seen = new WeakSet<object>();
  const visit = (value: object): void => {
    if (seen.has(value)) {
      return;
    }

    seen.add(value);
    const expr = value as Partial<FrontExpr>;

    if (
      expr.tag === "app" && expr.operator_syntax === undefined &&
      expr.args?.length === 1
    ) {
      const arg = expr.arg || expr.args[0];

      if (
        arg !== undefined && unary_argument_can_be_bare(arg) &&
        expr.func !== undefined && has_source_span(expr) &&
        has_source_span(expr.func) && has_source_span(arg)
      ) {
        const expression_span = source_span(expr);
        const function_span = source_span(expr.func);
        const argument_span = source_span(arg);
        const before = text.slice(function_span.end, argument_span.start);
        const after = text.slice(argument_span.end, expression_span.end);

        if (/^[ \t]*\([ \t]*$/.test(before) && /^[ \t]*\)$/.test(after)) {
          omitted.add(function_span.end + before.lastIndexOf("("));
          omitted.add(argument_span.end + after.lastIndexOf(")"));
        }
      }
    }

    for (const child of Object.values(value)) {
      if (child === null || typeof child !== "object") {
        continue;
      }

      if (Array.isArray(child)) {
        for (const entry of child) {
          if (entry !== null && typeof entry === "object") {
            visit(entry);
          }
        }
      } else {
        visit(child);
      }
    }
  };
  visit(parsed.source);
  return omitted;
}

function unary_argument_can_be_bare(expr: FrontExpr): boolean {
  return expr.tag === "bool" || expr.tag === "num" || expr.tag === "atom" ||
    expr.tag === "text" || expr.tag === "type_name" || expr.tag === "var" ||
    expr.tag === "field" || expr.tag === "index" || expr.tag === "linear" ||
    expr.tag === "shape" || expr.tag === "array" ||
    (expr.tag === "product" && expr.value_pack !== true);
}

function mark_effect_rows(tokens: Token[]): FormatToken[] {
  const marked: FormatToken[] = tokens.map((token) => ({ ...token }));
  let row_depth = 0;

  for (let index = 0; index < marked.length; index += 1) {
    const token = marked[index];

    if (token === undefined) {
      continue;
    }

    if (token.kind !== "symbol") {
      continue;
    }

    if (token.text === "<") {
      const previous = previous_content(marked, index);
      const arrow = previous?.kind === "symbol" &&
        (previous.text === "->" || previous.text === "=>");

      if (arrow || row_depth > 0) {
        token.row_open = true;
        row_depth += 1;
      }
    } else if (token.text === ">" && row_depth > 0) {
      token.row_close = true;
      row_depth -= 1;
    } else if (token.kind === "symbol" && token.text === "\n") {
      row_depth = 0;
    }
  }

  return marked;
}

function previous_content(
  tokens: FormatToken[],
  index: number,
): FormatToken | undefined {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const token = tokens[cursor];

    if (token === undefined) {
      continue;
    }

    if (token.kind !== "newline" && token.kind !== "comment") {
      return token;
    }
  }

  return undefined;
}

function split_lines(tokens: FormatToken[]): FormatToken[][] {
  const lines: FormatToken[][] = [];
  let current: FormatToken[] = [];
  let current_curly_depth = 0;
  let delimiter_depth = 0;
  let statement_ended = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === undefined) {
      continue;
    }

    if (token.kind === "eof") {
      break;
    }

    if (token.kind === "newline" && token.raw === ";") {
      if (statement_ended) {
        lines.push(current);
        current = [];
        current_curly_depth = 0;
      }

      current.push({ ...token, kind: "symbol", text: ";" });

      if (delimiter_depth === 0) {
        statement_ended = true;
      }
    } else if (
      token.kind === "newline" &&
      current.at(-1)?.text === ";" &&
      current_curly_depth > 0 &&
      tokens[index + 1]?.kind === "symbol" &&
      tokens[index + 1]?.text === "}"
    ) {
      continue;
    } else if (token.kind === "newline") {
      lines.push(current);
      current = [];
      current_curly_depth = 0;
      statement_ended = false;
    } else {
      if (statement_ended && token.kind !== "comment") {
        lines.push(current);
        current = [];
        current_curly_depth = 0;
        statement_ended = false;
      }

      current.push(token);

      if (token.kind === "symbol" && openers.has(token.text)) {
        delimiter_depth += 1;
      } else if (token.kind === "symbol" && closers.has(token.text)) {
        delimiter_depth -= 1;
      }

      if (token.kind === "symbol" && token.text === "{") {
        current_curly_depth += 1;
      } else if (token.kind === "symbol" && token.text === "}") {
        current_curly_depth -= 1;
      }
    }
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines;
}

function join_continuation_lines(
  lines: FormatToken[][],
): FormatToken[][] {
  const joined: FormatToken[][] = [];

  for (const line of lines) {
    const first = line[0];
    const previous = joined.at(-1);
    const starts_with_operator = first?.kind === "symbol" &&
      first.row_close !== true &&
      is_line_continuation_operator(first.text);

    if (
      starts_with_operator && previous !== undefined && previous.length > 0
    ) {
      previous.push(...line);
      continue;
    }

    joined.push(line);
  }

  return joined;
}

function next_content_line(
  lines: FormatToken[][],
  index: number,
): FormatToken[] | undefined {
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];

    if (line !== undefined && line.length > 0) {
      return line;
    }
  }

  return undefined;
}

function line_starts_with_closer(line: FormatToken[]): boolean {
  const first = line[0];
  return first !== undefined && first.kind === "symbol" &&
    closers.has(first.text);
}

function starts_with_alternative(line: FormatToken[]): boolean {
  const first = line[0];
  return first !== undefined && first.kind === "symbol" && first.text === "|";
}

function expand_delimited_entries(
  line: FormatToken[],
  available_width: number,
): FormatToken[][] | undefined {
  const groups: {
    close: number;
    commas: number[];
    depth: number;
    open: number;
  }[] = [];
  const stack: {
    commas: number[];
    depth: number;
    open: number;
    symbol: string;
  }[] = [];

  for (let index = 0; index < line.length; index += 1) {
    const token = line[index];

    if (token?.kind !== "symbol") {
      continue;
    }

    if (openers.has(token.text)) {
      stack.push({
        commas: [],
        depth: stack.length,
        open: index,
        symbol: token.text,
      });
      continue;
    }

    if (token.text === ",") {
      const group = stack.at(-1);

      if (group !== undefined) {
        group.commas.push(index);
      }
      continue;
    }

    if (!closers.has(token.text)) {
      continue;
    }

    const group = stack.pop();

    if (group === undefined) {
      continue;
    }

    const matching_brackets = (group.symbol === "{" && token.text === "}") ||
      (group.symbol === "(" && token.text === ")") ||
      (group.symbol === "[" && token.text === "]");
    if (!matching_brackets) {
      continue;
    }

    if (
      group.open + 1 < index &&
      (group.commas.length > 0 || group.symbol === "(") &&
      render_line(line.slice(0, index + 1)).length > available_width
    ) {
      groups.push({
        close: index,
        commas: group.commas,
        depth: group.depth,
        open: group.open,
      });
    }
  }

  groups.sort((left, right) => {
    if (left.depth !== right.depth) {
      return left.depth - right.depth;
    }

    return left.open - right.open;
  });
  const group = groups[0];

  if (group === undefined) {
    return undefined;
  }

  const expanded: FormatToken[][] = [line.slice(0, group.open + 1)];
  let entry_start = group.open + 1;

  for (const comma of group.commas) {
    expanded.push(line.slice(entry_start, comma + 1));
    entry_start = comma + 1;
  }

  const final_entry = line.slice(entry_start, group.close);
  const last = final_entry.at(-1);

  if (
    group.commas.length > 0 && last !== undefined &&
    !(last.kind === "symbol" && last.text === ",")
  ) {
    final_entry.push({
      ...last,
      kind: "symbol",
      raw: ",",
      text: ",",
    });
  }

  expanded.push(final_entry);
  expanded.push(line.slice(group.close));
  return expanded.filter((part) => part.length > 0);
}

function wrap_at_whitespace(
  line: FormatToken[],
  available_width: number,
): [FormatToken[], FormatToken[]] | undefined {
  let split: number | undefined;
  const annotation_end = line.findIndex((token) => {
    return token.kind === "symbol" && token.text === "=";
  });
  const annotation_start = line.findIndex((token) => {
    return token.kind === "symbol" && token.text === ":";
  });

  for (let index = 1; index < line.length; index += 1) {
    const token = line[index];

    if (
      token === undefined || token.kind !== "symbol" ||
      !is_line_continuation_operator(token.text)
    ) {
      continue;
    }

    const in_annotation = annotation_start >= 0 && annotation_end >= 0 &&
      index > annotation_start && index <= annotation_end;

    if (in_annotation) {
      continue;
    }

    if (render_line(line.slice(0, index)).length <= available_width) {
      split = index;
    }
  }

  if (split === undefined) {
    return undefined;
  }

  const left = line.slice(0, split);
  const right = line.slice(split);
  const first = right[0];

  if (first !== undefined) {
    right[0] = { ...first, continuation: true };
  }

  return [left, right];
}

function wrap_definition(
  line: FormatToken[],
): [FormatToken[], FormatToken[]] | undefined {
  const first = line[0];

  if (
    first?.kind !== "name" ||
    (first.text !== "const" && first.text !== "let" && first.text !== "type")
  ) {
    return undefined;
  }

  let delimiter_depth = 0;

  for (let index = 1; index < line.length; index += 1) {
    const token = line[index];

    if (token?.kind !== "symbol") {
      continue;
    }

    if (openers.has(token.text)) {
      delimiter_depth += 1;
      continue;
    }

    if (closers.has(token.text)) {
      delimiter_depth -= 1;
      continue;
    }

    if (token.text !== "=" || delimiter_depth !== 0) {
      continue;
    }

    const left = line.slice(0, index + 1);
    const right = line.slice(index + 1);
    const right_first = right[0];

    if (right_first === undefined) {
      return undefined;
    }

    right[0] = { ...right_first, continuation: true };
    return [left, right];
  }

  return undefined;
}

function is_line_continuation_operator(symbol: string): boolean {
  return !openers.has(symbol) && !closers.has(symbol) &&
    symbol !== "." && symbol !== "," && symbol !== ":" && symbol !== ";" &&
    symbol !== "=" && symbol !== ":=" && symbol !== "=>" && symbol !== "->" &&
    symbol !== "<-" && symbol !== "!" && symbol !== "#" && symbol !== "@" &&
    symbol !== "`" && symbol !== "..." && symbol !== "&" && symbol !== "\\" &&
    symbol !== "|";
}

function render_line(line: FormatToken[]): string {
  let rendered = "";

  for (let index = 0; index < line.length; index += 1) {
    const token = line[index];

    if (token === undefined) {
      continue;
    }

    if (index > 0) {
      const previous = line[index - 1];

      if (previous !== undefined && needs_space(previous, token, line, index)) {
        rendered += " ";
      }
    }

    rendered += render_token(token);
  }

  return rendered.trimEnd();
}

function render_token(token: FormatToken): string {
  if (token.kind === "string") {
    return '"' + escape_literal(token.text, '"') + '"';
  }

  if (token.kind === "character") {
    return "'" + escape_literal(token.text, "'") + "'";
  }

  if (token.kind === "comment") {
    return normalize_comment(token.text);
  }

  return token.text;
}

function escape_literal(value: string, quote: '"' | "'"): string {
  let escaped = "";

  for (const char of value) {
    if (char === "\\") {
      escaped += "\\\\";
    } else if (char === quote) {
      escaped += "\\" + quote;
    } else if (char === "\n") {
      escaped += "\\n";
    } else if (char === "\t") {
      escaped += "\\t";
    } else if (char === "\r") {
      escaped += "\\r";
    } else {
      escaped += char;
    }
  }

  return escaped;
}

function normalize_comment(text: string): string {
  const body = text.slice(2);

  if (body === "" || body.startsWith(" ") || body.startsWith("/")) {
    return "//" + body.trimEnd();
  }

  return "// " + body.trimEnd();
}

function is_value_end(token: FormatToken): boolean {
  if (token.kind === "name") {
    return !keywords.has(token.text);
  }

  if (
    token.kind === "number" || token.kind === "string" ||
    token.kind === "character"
  ) {
    return true;
  }

  return token.kind === "symbol" && closers.has(token.text);
}

function is_rec_declaration(line: FormatToken[], open: number): boolean {
  let depth = 0;

  for (let index = open; index < line.length; index += 1) {
    const token = line[index];

    if (token === undefined || token.kind !== "symbol") {
      continue;
    }

    if (token.text === "(") {
      depth += 1;
    } else if (token.text === ")") {
      depth -= 1;

      if (depth === 0) {
        const next = line[index + 1];
        return next !== undefined && next.kind === "symbol" &&
          next.text === "=>";
      }
    }
  }

  return false;
}

function is_prefix_position(
  line: FormatToken[],
  index: number,
): boolean {
  const previous = line[index - 1];
  return previous === undefined || !is_value_end(previous);
}

function needs_space(
  previous: FormatToken,
  token: FormatToken,
  line: FormatToken[],
  index: number,
): boolean {
  // Comments keep a single space before them when trailing a line.
  if (token.kind === "comment") {
    return true;
  }

  if (previous.kind === "comment") {
    return true;
  }

  // No space directly after an opener or a tight prefix.
  if (previous.kind === "symbol") {
    if (previous.text === "(" || previous.text === "[") {
      return false;
    }

    if (previous.row_open) {
      return false;
    }

    if (previous.text === "." || previous.text === "..") {
      return false;
    }

    if (prefix_symbols.has(previous.text)) {
      const first = line[0];
      const separates_fixity_target = index === 3 && token.kind === "symbol" &&
        token.text === "=" && first?.kind === "name" &&
        (first.text === "prefix" || first.text === "infix" ||
          first.text === "infixl" || first.text === "infixr");

      if (!separates_fixity_target) {
        return false;
      }
    }

    if (
      (positional_symbols.has(previous.text) || previous.text === "-") &&
      is_prefix_position(line, index - 1)
    ) {
      return false;
    }
  }

  if (token.kind === "symbol") {
    // No space before closers, separators, or tight accessors.
    if (
      token.text === ")" || token.text === "]" || token.text === "," ||
      token.text === ";"
    ) {
      return false;
    }

    if (
      token.text === "}" && previous.kind === "symbol" && previous.text === "{"
    ) {
      return false;
    }

    if (token.row_close) {
      return false;
    }

    if (token.text === ":") {
      return false;
    }

    // Field access and ranges glue to a preceding value; leading dots in
    // aggregate and union-case position keep the spacing of their context
    // (none after an opener, one space after separators and keywords).
    if (token.text === "." || token.text === "..") {
      return !is_value_end(previous);
    }

    if (token.text === "[" && is_value_end(previous)) {
      return previous.span.end < token.span.start;
    }

    // Parenthesized calls glue to the value they apply to.
    if (token.text === "(" && is_value_end(previous)) {
      const before_previous = line[index - 2];

      if (before_previous?.kind === "symbol" && before_previous.text === "`") {
        return true;
      }

      if (
        previous.kind === "string" && before_previous?.kind === "name" &&
        before_previous.text === "import"
      ) {
        return true;
      }

      return false;
    }

    // `rec (left, right) => ...` declares parameters; `rec(left, right)`
    // is the recursive call.
    if (
      token.text === "(" && previous.kind === "name" &&
      previous.text === "rec"
    ) {
      return is_rec_declaration(line, index);
    }

    if (spaced_symbols.has(token.text)) {
      return true;
    }
  }

  return true;
}

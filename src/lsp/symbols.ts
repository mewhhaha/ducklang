import type { Token } from "../frontend/ast.ts";
import { tokenize } from "../frontend/tokenize.ts";
import type { LspRange } from "./diagnostics.ts";

export type LspDocumentSymbol = {
  name: string;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  children: LspDocumentSymbol[];
};

const symbol_kind = {
  module: 2,
  class: 5,
  interface: 11,
  function: 12,
  variable: 13,
  constant: 14,
} as const;

// Symbols come straight from the token stream: top-level `let`, `const`,
// `type`, `effect`, `declare`, `import`, and `module` introductions. This
// stays useful even while the buffer has parse errors further down.
export function document_symbols(text: string): LspDocumentSymbol[] {
  let tokens: Token[];

  try {
    tokens = tokenize(text);
  } catch {
    return [];
  }

  const symbols: LspDocumentSymbol[] = [];
  let depth = 0;
  let line_start = true;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === undefined || token.kind === "eof") {
      break;
    }

    if (token.kind === "newline") {
      line_start = true;
      continue;
    }

    if (token.kind === "symbol") {
      if (token.text === "{" || token.text === "(" || token.text === "[") {
        depth += 1;
      } else if (
        token.text === "}" || token.text === ")" || token.text === "]"
      ) {
        depth = Math.max(0, depth - 1);
      }

      line_start = false;
      continue;
    }

    if (!line_start || depth > 0 || token.kind !== "name") {
      line_start = false;
      continue;
    }

    line_start = false;
    const symbol = introduction(tokens, index, token);

    if (symbol !== undefined) {
      symbols.push(symbol);
    }
  }

  return symbols;
}

function introduction(
  tokens: Token[],
  index: number,
  keyword: Token,
): LspDocumentSymbol | undefined {
  if (keyword.text === "module") {
    return make_symbol("module", symbol_kind.module, keyword, keyword);
  }

  if (keyword.text === "let" || keyword.text === "const") {
    const name = binding_name(tokens, index + 1);

    if (name === undefined) {
      return undefined;
    }

    const kind = keyword.text === "const"
      ? symbol_kind.constant
      : line_has_arrow(tokens, index)
      ? symbol_kind.function
      : symbol_kind.variable;
    return make_symbol(name.text, kind, keyword, name);
  }

  if (keyword.text === "type") {
    const name = next_name(tokens, index + 1);
    return name === undefined
      ? undefined
      : make_symbol(name.text, symbol_kind.class, keyword, name);
  }

  if (keyword.text === "effect") {
    const name = next_name(tokens, index + 1);
    return name === undefined
      ? undefined
      : make_symbol(name.text, symbol_kind.interface, keyword, name);
  }

  if (keyword.text === "declare") {
    const first = next_name(tokens, index + 1);

    if (first === undefined) {
      return undefined;
    }

    const name = first.text === "effect" ? next_name(tokens, index + 2) : first;
    return name === undefined
      ? undefined
      : make_symbol(name.text, symbol_kind.interface, keyword, name);
  }

  if (keyword.text === "import") {
    const name = next_name(tokens, index + 1);
    return name === undefined
      ? undefined
      : make_symbol(name.text, symbol_kind.module, keyword, name);
  }

  return undefined;
}

function binding_name(tokens: Token[], index: number): Token | undefined {
  const token = tokens[index];

  if (token === undefined) {
    return undefined;
  }

  if (token.kind === "symbol" && token.text === "!") {
    return next_name(tokens, index + 1);
  }

  return token.kind === "name" ? token : undefined;
}

function next_name(tokens: Token[], index: number): Token | undefined {
  const token = tokens[index];
  return token !== undefined && token.kind === "name" ? token : undefined;
}

function line_has_arrow(tokens: Token[], index: number): boolean {
  for (let cursor = index; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor];

    if (token === undefined || token.kind === "newline") {
      return false;
    }

    if (token.kind === "symbol" && token.text === "=>") {
      return true;
    }
  }

  return false;
}

function make_symbol(
  name: string,
  kind: number,
  keyword: Token,
  target: Token,
): LspDocumentSymbol {
  const selection = token_range(target);
  return {
    name,
    kind,
    range: {
      start: token_range(keyword).start,
      end: selection.end,
    },
    selectionRange: selection,
    children: [],
  };
}

function token_range(token: Token): LspRange {
  const line = token.line - 1;
  const character = token.column - 1;
  return {
    start: { line, character },
    end: { line, character: character + Math.max(token.text.length, 1) },
  };
}

import type { SyntaxDiagnostic } from "./syntax.ts";

export type BabaToken = {
  text: string;
  start: number;
  end: number;
};

export type BabaCst = {
  text: string;
  tree: string;
};

export type BabaParseResult = {
  tokens: BabaToken[];
  diagnostics: SyntaxDiagnostic[];
  cst: BabaCst;
};

/** Parse Duck source with the generated Baba Tree-sitter parser. */
export function parse_duck_source(text: string): BabaParseResult {
  const temporary_path = Deno.makeTempFileSync({ suffix: ".duck" });

  try {
    Deno.writeTextFileSync(temporary_path, text);
    const result = new Deno.Command("tree-sitter", {
      args: [
        "parse",
        "--grammar-path",
        new URL("../../tree-sitter-duck/", import.meta.url).pathname,
        "--cst",
        temporary_path,
      ],
      stdout: "piped",
      stderr: "piped",
    }).outputSync();
    const tree = new TextDecoder().decode(result.stdout);
    let diagnostics: SyntaxDiagnostic[] = [];
    if (!result.success || tree.includes("ERROR")) {
      const message = "Baba parser rejected source";
      diagnostics = [{
        message,
        span: { start: 0, end: text.length },
      }];
    }

    return {
      tokens: cst_tokens(tree, text),
      diagnostics,
      cst: { text, tree },
    };
  } finally {
    Deno.removeSync(temporary_path);
  }
}

function cst_tokens(tree: string, source: string): BabaToken[] {
  const tokens: BabaToken[] = [];
  let search_start = 0;

  for (const line of tree.split("\n")) {
    const match = line.match(
      /\s+([A-Za-z_][A-Za-z0-9_]*|`[^`]*`|\"[^\"]*\"|'[^']*'|[^ `]+)\s*$/,
    );
    if (match === null) continue;

    let text = match[1];
    if (
      (text.startsWith("`") && text.endsWith("`")) ||
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))
    ) {
      text = text.slice(1, -1);
    }

    const start = source.indexOf(text, search_start);
    if (start < 0) continue;

    const end = start + text.length;
    tokens.push({ text, start, end });
    search_start = end;
  }

  return tokens;
}

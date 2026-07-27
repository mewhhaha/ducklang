import {
  generate,
  parseGrammar,
  parseMetadata,
  validateGrammar,
} from "@mewhhaha/baba";

const repository = new URL("../", import.meta.url);
const grammar_directory = new URL("tree-sitter-duck/", repository);
const generated_paths = [
  "src/grammar.json",
  "src/node-types.json",
  "src/parser.c",
];
let check_only = false;
for (const argument of Deno.args) {
  if (argument === "--check") {
    check_only = true;
    continue;
  }

  throw new Error(`Unknown grammar generation argument ${argument}.`);
}

const grammar_source = await Deno.readTextFile(
  new URL("grammar.baba", grammar_directory),
);
const metadata = parseMetadata(
  await Deno.readTextFile(new URL("baba.json", grammar_directory)),
);
const parsed_grammar = parseGrammar(grammar_source);
const validation_diagnostics = validateGrammar(parsed_grammar, {
  targets: ["tree-sitter"],
});
const validation_errors = validation_diagnostics.filter((diagnostic) =>
  diagnostic.severity === undefined || diagnostic.severity === "error"
);
if (validation_errors.length > 0) {
  const rendered = validation_errors.map((diagnostic) =>
    `${diagnostic.code}: ${diagnostic.message}`
  ).join("\n");
  throw new Error(`Baba grammar validation failed:\n${rendered}`);
}
const bundle = generate(grammar_source, {
  name: "duck",
  rootRule: "document",
  metadata,
  targets: ["tree-sitter"],
});
const grammar_file = bundle.files.find((file) => file.path === "grammar.js");
const scanner_file = bundle.files.find((file) => file.path === "src/scanner.c");

if (grammar_file === undefined) {
  throw new Error("Baba did not generate grammar.js for the Duck grammar.");
}
if (grammar_file.encoding !== "utf-8") {
  throw new Error(
    `Baba generated grammar.js with unexpected ${grammar_file.encoding} encoding.`,
  );
}
if (scanner_file !== undefined && scanner_file.encoding !== "utf-8") {
  throw new Error(
    `Baba generated scanner.c with unexpected ${scanner_file.encoding} encoding.`,
  );
}
const generated_grammar = adapt_tree_sitter_grammar(grammar_file.content);
const checked_in_grammar_url = new URL("grammar.js", grammar_directory);

if (check_only) {
  const checked_in_grammar = await Deno.readTextFile(checked_in_grammar_url);
  if (checked_in_grammar !== generated_grammar) {
    throw new Error(
      "tree-sitter-duck/grammar.js differs from the Baba grammar; " +
        "run `deno task grammar:generate` and commit the result.",
    );
  }
} else {
  await Deno.writeTextFile(checked_in_grammar_url, generated_grammar);
}

const temporary_directory = await Deno.makeTempDir({
  prefix: "ducklang-grammar-",
});
const temporary_grammar_directory = temporary_directory +
  "/tree-sitter-duck";

try {
  await Deno.mkdir(temporary_grammar_directory + "/src", { recursive: true });
  await Deno.writeTextFile(
    temporary_grammar_directory + "/grammar.js",
    generated_grammar,
  );
  if (scanner_file !== undefined) {
    await Deno.writeTextFile(
      temporary_grammar_directory + "/src/scanner.c",
      scanner_file.content,
    );
  }
  for (
    const relative_path of [
      "package.json",
      "tree-sitter.json",
    ]
  ) {
    await Deno.copyFile(
      new URL(relative_path, grammar_directory),
      temporary_grammar_directory + "/" + relative_path,
    );
  }

  let generation_directory: string | URL = grammar_directory;
  if (check_only) {
    generation_directory = temporary_grammar_directory;
  }
  await run_tree_sitter_generate(
    generation_directory,
    temporary_directory + "/cache",
  );

  if (check_only) {
    for (const generated_path of generated_paths) {
      const checked_in = await Deno.readFile(
        new URL(generated_path, grammar_directory),
      );
      const generated = await Deno.readFile(
        temporary_grammar_directory + "/" + generated_path,
      );

      if (!same_bytes(checked_in, generated)) {
        throw new Error(
          `tree-sitter-duck/${generated_path} differs from the Baba grammar; ` +
            "run `deno task grammar:generate` and commit the result.",
        );
      }
    }
    const checked_in_scanner = new URL("src/scanner.c", grammar_directory);
    if (scanner_file === undefined) {
      let scanner_exists = true;
      try {
        await Deno.stat(checked_in_scanner);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          scanner_exists = false;
        } else {
          throw error;
        }
      }
      if (scanner_exists) {
        throw new Error(
          "tree-sitter-duck/src/scanner.c exists but Baba did not generate it; " +
            "remove the stale artifact before running grammar:check.",
        );
      }
    } else {
      const checked_in = await Deno.readTextFile(checked_in_scanner);
      if (checked_in !== scanner_file.content) {
        throw new Error(
          "tree-sitter-duck/src/scanner.c differs from the Baba grammar; " +
            "run `deno task grammar:generate` and commit the result.",
        );
      }
    }
  } else if (scanner_file !== undefined) {
    await Deno.writeTextFile(
      new URL("src/scanner.c", grammar_directory),
      scanner_file.content,
    );
  } else {
    try {
      await Deno.remove(new URL("src/scanner.c", grammar_directory));
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
} finally {
  await Deno.remove(temporary_directory, { recursive: true });
}

function adapt_tree_sitter_grammar(source: string): string {
  const generated_header =
    "// Generated by @mewhhaha/baba. Do not edit by hand.\n";

  if (!source.startsWith(generated_header)) {
    throw new Error(
      "Baba's generated grammar.js no longer contains the expected header.",
    );
  }

  source = source.replace(
    generated_header,
    generated_header + "// deno-lint-ignore-file no-unused-vars\n",
  );

  const baba_extras = `  extras: $ => [
    $._whitespace,
    $.comment,
  ],
`;
  if (!source.includes(baba_extras)) {
    throw new Error(
      "Baba's generated grammar.js no longer contains the expected native extras.",
    );
  }

  return source;
}

async function run_tree_sitter_generate(
  directory: string | URL,
  cache_directory: string,
): Promise<void> {
  const generation = await new Deno.Command("tree-sitter", {
    args: ["generate"],
    cwd: directory,
    env: {
      XDG_CACHE_HOME: cache_directory,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (generation.success) {
    return;
  }

  const stderr = new TextDecoder().decode(generation.stderr).trim();
  throw new Error(
    "Tree-sitter grammar generation failed with exit code " +
      generation.code.toString() + ": " + stderr,
  );
}

function same_bytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

const repository = new URL("../", import.meta.url);
const grammar_directory = new URL("tree-sitter-duck/", repository);
const generated_paths = [
  "src/grammar.json",
  "src/node-types.json",
  "src/parser.c",
];

const temporary_directory = Deno.makeTempDirSync({
  prefix: "ducklang-grammar-",
});
const temporary_grammar_url = new URL(
  "tree-sitter-duck/",
  path_url(temporary_directory + "/"),
);

try {
  Deno.mkdirSync(temporary_grammar_url, { recursive: true });
  copy_grammar_input("grammar.js");
  copy_grammar_input("package.json");
  copy_grammar_input("tree-sitter.json");
  Deno.mkdirSync(new URL("src/", temporary_grammar_url), { recursive: true });
  copy_grammar_input("src/scanner.c");

  const generation = new Deno.Command("tree-sitter", {
    args: ["generate"],
    cwd: temporary_grammar_url,
    env: {
      XDG_CACHE_HOME: temporary_directory + "/cache",
    },
    stdout: "piped",
    stderr: "piped",
  }).outputSync();

  if (!generation.success) {
    const stderr = new TextDecoder().decode(generation.stderr).trim();
    throw new Error(
      "Tree-sitter grammar generation failed with exit code " +
        generation.code.toString() + ": " + stderr,
    );
  }

  for (const generated_path of generated_paths) {
    const checked_in = Deno.readFileSync(
      new URL("tree-sitter-duck/" + generated_path, repository),
    );
    const generated = Deno.readFileSync(
      new URL(generated_path, temporary_grammar_url),
    );

    if (!same_bytes(checked_in, generated)) {
      throw new Error(
        "Generated grammar artifact differs from tree-sitter-duck/" +
          generated_path + "; run tree-sitter generate and commit the result",
      );
    }
  }
} finally {
  Deno.removeSync(temporary_directory, { recursive: true });
}

function copy_grammar_input(relative_path: string): void {
  const destination = new URL(relative_path, temporary_grammar_url);
  const slash = relative_path.lastIndexOf("/");

  if (slash !== -1) {
    Deno.mkdirSync(
      new URL(relative_path.slice(0, slash + 1), temporary_grammar_url),
      { recursive: true },
    );
  }

  Deno.copyFileSync(new URL(relative_path, grammar_directory), destination);
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

function path_url(path: string): URL {
  return new URL("file://" + path);
}

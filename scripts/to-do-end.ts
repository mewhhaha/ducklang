/**
 * Codemod for the `do … end` migration.
 *
 * Reads a file with the *previous* tree-sitter grammar and rewrites it into the
 * final keyword-delimited syntax. Every edit is anchored to a node position from that
 * parse, so brace-delimited data (`struct { … }`, record literals, shape
 * patterns) is left alone while brace-delimited *code* becomes `do … end`.
 * Plain text substitution cannot make that distinction, which is why this goes
 * through the parser.
 *
 * The old parser is generated into a scratch directory from git, because the
 * checked-in one has already moved to the new grammar:
 *
 *   mkdir -p /tmp/oldts/src
 *   for f in grammar.js package.json tree-sitter.json; do
 *     git show <old-rev>:tree-sitter-duck/$f > /tmp/oldts/$f
 *   done
 *   git show <old-rev>:tree-sitter-duck/src/scanner.c > /tmp/oldts/src/scanner.c
 *   (cd /tmp/oldts && tree-sitter generate)
 *
 *   deno run -A scripts/to-do-end.ts <path…>
 */

const OLD_PARSER_DIRECTORY = "/tmp/oldts";
/** Revision holding the brace grammar this codemod reads. */
const OLD_GRAMMAR_REVISION = "HEAD";

/**
 * Builds the previous grammar into a scratch directory, under a *different*
 * grammar name. The tree-sitter CLI caches a compiled parser by grammar name,
 * so leaving both called `duck` lets a regenerated repo grammar poison this
 * one's cache — after which the codemod silently reads old files with the new
 * parser and every query comes back empty.
 */
async function ensure_old_parser(): Promise<void> {
  const marker = OLD_PARSER_DIRECTORY + "/src/parser.c";

  if (await Deno.stat(marker).then(() => true).catch(() => false)) {
    return;
  }

  await Deno.mkdir(OLD_PARSER_DIRECTORY + "/src", { recursive: true });

  for (
    const relative of [
      "grammar.js",
      "package.json",
      "tree-sitter.json",
      "src/scanner.c",
    ]
  ) {
    const show = await new Deno.Command("git", {
      args: ["show", OLD_GRAMMAR_REVISION + ":tree-sitter-duck/" + relative],
      stdout: "piped",
    }).output();

    if (!show.success) {
      throw new Error("Could not read " + relative + " from git.");
    }

    // Rename only the grammar's own name and its scanner symbols. `"duck"` is
    // also the spelling of the `duck` keyword token, so replacing it globally
    // makes the old parser stop recognising `duck … { }` declarations and read
    // them as function application instead — a silent misparse, not an error.
    const text = new TextDecoder().decode(show.stdout)
      .replaceAll('name: "duck"', 'name: "duckold"')
      .replaceAll('"name": "duck"', '"name": "duckold"')
      .replaceAll("tree_sitter_duck_", "tree_sitter_duckold_");
    await Deno.writeTextFile(OLD_PARSER_DIRECTORY + "/" + relative, text);
  }

  const generate = await new Deno.Command("tree-sitter", {
    args: ["generate"],
    cwd: OLD_PARSER_DIRECTORY,
    env: { XDG_CACHE_HOME: "/tmp/dtsc3" },
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (!generate.success) {
    throw new Error(
      "Old grammar generation failed: " +
        new TextDecoder().decode(generate.stderr).trim(),
    );
  }
}

type Edit = { start: number; end: number; text: string };

/**
 * What to do with a captured node. Spelled out rather than encoded into the
 * replacement string: an earlier version marked insertions with a leading NUL,
 * which is invisible in every editor and silently turned an insertion into a
 * whole-node replacement.
 */
type Action =
  | { kind: "replace"; text: string }
  | { kind: "insert_before"; text: string }
  | { kind: "terminate_after" }
  | { kind: "delete_with_space" };

const replace = (text: string): Action => ({ kind: "replace", text });
const insert_before = (text: string): Action => ({
  kind: "insert_before",
  text,
});
const delete_with_space: Action = { kind: "delete_with_space" };
const terminate_after: Action = { kind: "terminate_after" };

/** Queries run against the old tree, each mapping a captured token to an action. */
const QUERIES: { query: string; actions: Record<string, Action> }[] = [
  // Code blocks. `block` never covers a record or struct literal, so this
  // cannot touch brace-delimited data.
  {
    query: `(block "{" @open "}" @close)`,
    actions: { open: replace("do"), close: replace("end") },
  },
  // Conditional branches are implicit blocks. An `else` followed by another
  // condition continues the same conditional and the last branch supplies its
  // single closing `end`.
  {
    query:
      `(if_expression consequence: (block "{" @branch_open "}" @branch_close) alternative: (_))`,
    actions: {
      branch_open: replace("then"),
      branch_close: replace(""),
    },
  },
  {
    query:
      `(if_expression consequence: (block "{" @final_open "}" @final_close) !alternative)`,
    actions: {
      final_open: replace("then"),
      final_close: replace("end"),
    },
  },
  {
    query:
      `(if_expression alternative: (block "{" @else_open "}" @else_close))`,
    actions: {
      else_open: replace(""),
      else_close: replace("end"),
    },
  },
  {
    query: `(if_expression alternative: (if_expression "if" @else_if))`,
    actions: { else_if: delete_with_space },
  },
  // Effect operations and handler clauses keep their braces. They are member
  // lists, like a struct or a record, not statement blocks — so braces mean
  // "members" and `do … end` means "statements". That distinction is also what
  // keeps `end` usable as a member name: `effect E { end: (I32) => Unit }`
  // appears in the corpus and would otherwise collide with the block closer.
  {
    query: `(match_case_block "{" @open "}" @close)`,
    actions: { open: replace("with"), close: replace("end") },
  },
  // `set` marks every assignment, so a statement always begins with a keyword.
  {
    query: `(assignment name: (_) @name)`,
    actions: { name: insert_before("set ") },
  },
  {
    query: `(index_assignment name: (_) @name)`,
    actions: { name: insert_before("set ") },
  },
  // `rec` stays. It is not a scoping detail but a compilation strategy: a
  // recursive binding becomes a named function in `recFunctions`, emitted once,
  // while a plain lambda is specialised per call site. Inferring it from the
  // body cannot be done reliably — a token spelled like the binding may be a
  // shadowed inner name — and getting it wrong silently costs specialisation.
  // A statement-position block needs a terminator that the brace form did not.
  // `end` closes an expression, so `end` followed by `[` on the next line reads
  // as an index into the block's value rather than a new statement — the same
  // continuation problem semicolons exist to solve.
  {
    query:
      `(expression_statement [(if_expression) (loop_expression) (match_expression) (scratch_expression)] @statement)`,
    actions: { statement: terminate_after },
  },
];

type Point = { row: number; column: number };

/**
 * Byte offsets of each line start. Tree-sitter reports a column as a count of
 * UTF-8 bytes, while a JavaScript string indexes UTF-16 code units, so every
 * offset here stays in bytes. Mixing the two shifts every edit after the first
 * non-ASCII character on a line — 23 files in this corpus contain one.
 */
function line_offsets(bytes: Uint8Array): number[] {
  const starts = [0];

  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0x0a) {
      starts.push(index + 1);
    }
  }

  return starts;
}

function offset_at(line_starts: number[], point: Point): number {
  const start = line_starts[point.row];

  if (start === undefined) {
    throw new Error("Point outside the source: row " + point.row.toString());
  }

  return start + point.column;
}

async function run_query(
  query: string,
  path: string,
): Promise<{ capture: string; start: Point; end: Point }[]> {
  const file = await Deno.makeTempFile({ suffix: ".scm" });
  await Deno.writeTextFile(file, query);

  // `cwd` selects the old grammar, so the target has to be absolute.
  const result = await new Deno.Command("tree-sitter", {
    args: ["query", file, await Deno.realPath(path)],
    cwd: OLD_PARSER_DIRECTORY,
    env: { XDG_CACHE_HOME: "/tmp/dtsc3" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  await Deno.remove(file);

  if (!result.success) {
    throw new Error(
      "Query failed on " + path + ": " +
        new TextDecoder().decode(result.stderr).trim(),
    );
  }

  // A query with several capture names prints `capture: 0 - name`; one with a
  // single capture name prints a bare `capture: name`. Both forms occur here.
  const pattern =
    /capture: (?:\d+ - )?([\w.]+), start: \((\d+), (\d+)\), end: \((\d+), (\d+)\)/g;
  const stdout = new TextDecoder().decode(result.stdout);
  const matches: { capture: string; start: Point; end: Point }[] = [];

  for (const match of stdout.matchAll(pattern)) {
    matches.push({
      capture: match[1],
      start: { row: Number(match[2]), column: Number(match[3]) },
      end: { row: Number(match[4]), column: Number(match[5]) },
    });
  }

  return matches;
}

/**
 * Every edit is anchored to a node from the old parse, so a file the old
 * grammar cannot read produces confident nonsense rather than a failure. Refuse
 * those instead of rewriting them.
 */
async function assert_parses(path: string): Promise<void> {
  const parse = await new Deno.Command("tree-sitter", {
    args: ["parse", "--quiet", await Deno.realPath(path)],
    cwd: OLD_PARSER_DIRECTORY,
    env: { XDG_CACHE_HOME: "/tmp/dtsc3" },
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (!parse.success) {
    throw new Error(
      "Refusing to convert " + path + ": it does not parse with the previous " +
        "grammar, so node positions cannot be trusted.",
    );
  }
}

export async function convert(path: string): Promise<Uint8Array> {
  await ensure_old_parser();
  await assert_parses(path);
  const source = await Deno.readFile(path);
  const line_starts = line_offsets(source);
  const edits = new Map<string, Edit>();
  const record_edit = (edit: Edit): void => {
    edits.set(edit.start.toString() + ":" + edit.end.toString(), edit);
  };

  for (const { query, actions } of QUERIES) {
    for (const match of await run_query(query, path)) {
      const action = actions[match.capture];

      if (action === undefined) {
        continue;
      }

      const start = offset_at(line_starts, match.start);
      const end = offset_at(line_starts, match.end);

      if (action.kind === "insert_before") {
        record_edit({ start, end: start, text: action.text });
        continue;
      }

      if (action.kind === "terminate_after") {
        let next = end;

        while (
          source[next] === 0x20 || source[next] === 0x09 ||
          source[next] === 0x0a || source[next] === 0x0d
        ) {
          next += 1;
        }

        // Already terminated, or the construct is the block's own tail.
        if (source[next] !== 0x3b) {
          record_edit({ start: end, end, text: ";" });
        }

        continue;
      }

      if (action.kind === "delete_with_space") {
        let cut = end;

        while (source[cut] === 0x20) {
          cut += 1;
        }

        record_edit({ start, end: cut, text: "" });
        continue;
      }

      record_edit({ start, end, text: action.text });
    }
  }

  // Descending, so earlier offsets stay valid as edits apply. At one offset a
  // replacement must run before an insertion, or `then` would land after the
  // `do` it introduces rather than before it.
  const ordered_edits = [...edits.values()].sort((left, right) => {
    if (left.start !== right.start) {
      return right.start - left.start;
    }

    return (right.end - right.start) - (left.end - left.start);
  });

  const encoder = new TextEncoder();
  const pieces: Uint8Array[] = [];
  let cursor = source.length;

  // Walk the descending edits, emitting the untouched run that follows each one
  // before the replacement itself, then reverse — cheaper than rebuilding the
  // whole buffer per edit.
  for (const edit of ordered_edits) {
    pieces.push(source.subarray(edit.end, cursor));
    pieces.push(encoder.encode(edit.text));
    cursor = edit.start;
  }

  pieces.push(source.subarray(0, cursor));
  pieces.reverse();

  const size = pieces.reduce((total, piece) => total + piece.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;

  for (const piece of pieces) {
    output.set(piece, offset);
    offset += piece.length;
  }

  return output;
}

if (import.meta.main) {
  let converted = 0;
  let skipped = 0;

  for (
    const path of Deno.args.filter((argument) => !argument.startsWith("-"))
  ) {
    // A file already in the new syntax no longer parses with the old grammar,
    // so the guard rejects it and the sweep is safe to re-run over everything.
    try {
      await Deno.writeFile(path, await convert(path));
      converted += 1;
    } catch {
      skipped += 1;
    }
  }

  console.error(
    "converted " + converted.toString() + ", skipped " + skipped.toString(),
  );
}

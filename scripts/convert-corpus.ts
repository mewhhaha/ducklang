/**
 * Rewrites the tree-sitter corpus sources into the `do … end` syntax.
 *
 * Each corpus entry is a header block, a source section, a `---` separator and
 * an expected tree. Only the source is rewritten here — regenerate the trees
 * afterwards with `tree-sitter test --update`, which is the tool's own job.
 *
 *   deno run -A scripts/convert-corpus.ts tree-sitter-duck/test/corpus/*.txt
 */
import { convert } from "./to-do-end.ts";

const decoder = new TextDecoder();

/** A header is a `===` rule, a title line, and a closing `===` rule. */
function is_rule(line: string): boolean {
  return /^={3,}$/.test(line);
}

async function convert_source(source: string): Promise<string> {
  const file = await Deno.makeTempFile({ suffix: ".duck" });
  await Deno.writeTextFile(file, source);

  try {
    return decoder.decode(await convert(file));
  } finally {
    await Deno.remove(file);
  }
}

for (const path of Deno.args) {
  const lines = (await Deno.readTextFile(path)).split("\n");
  const output: string[] = [];
  let index = 0;
  let converted = 0;
  let skipped = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line === undefined) {
      break;
    }

    const title = lines[index + 1];
    const closing_rule = lines[index + 2];
    if (
      title !== undefined && closing_rule !== undefined &&
      is_rule(line) && is_rule(closing_rule)
    ) {
      output.push(line, title, closing_rule);
      index += 3;

      const source: string[] = [];

      while (index < lines.length) {
        const source_line = lines[index];
        if (source_line === undefined || source_line.trim() === "---") {
          break;
        }
        source.push(source_line);
        index += 1;
      }

      const text = source.join("\n");
      let rewritten = text;

      // Some entries are deliberate fragments that never parsed on their own.
      // The codemod refuses those; leave them for a human rather than guessing.
      try {
        rewritten = await convert_source(text);
      } catch {
        skipped += 1;
      }

      if (rewritten !== text) {
        converted += 1;
      }

      output.push(...rewritten.split("\n"));
      continue;
    }

    output.push(line);
    index += 1;
  }

  await Deno.writeTextFile(path, output.join("\n"));
  console.error(
    path.split("/").pop() + ": rewrote " + converted.toString() +
      " sources, skipped " + skipped.toString(),
  );
}

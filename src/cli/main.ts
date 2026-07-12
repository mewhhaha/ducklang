import { format_text } from "../fmt/format.ts";
import { run_lsp } from "../lsp/server.ts";
import { Source } from "../frontend.ts";

const usage = `Usage: ix <command>

Commands:
  fmt [paths...] [--check]  Format .ix files in place; --check only reports
  fmt --stdin               Format source from stdin to stdout
  check <paths...>          Parse .ix files and report diagnostics
  lsp                       Run the language server over stdio
`;

export async function run_cli(args: string[]): Promise<number> {
  const command = args[0];

  if (command === "fmt") {
    return await run_fmt(args.slice(1));
  }

  if (command === "check") {
    return await run_check(args.slice(1));
  }

  if (command === "lsp") {
    return await run_lsp();
  }

  console.error(usage.trimEnd());
  return command === undefined || command === "--help" || command === "help"
    ? 0
    : 1;
}

async function run_fmt(args: string[]): Promise<number> {
  const check = args.includes("--check");
  const stdin = args.includes("--stdin");
  const paths = args.filter((arg) => !arg.startsWith("--"));

  if (stdin) {
    const text = new TextDecoder().decode(
      await read_all(Deno.stdin.readable),
    );
    const failure = parse_failure(text);

    if (failure !== undefined) {
      console.error("<stdin>: " + failure);
      return 1;
    }

    await write_stdout(format_text(text));
    return 0;
  }

  const files = await collect_files(paths.length > 0 ? paths : ["."]);
  let changed = 0;
  let failed = 0;

  for (const file of files) {
    const text = await Deno.readTextFile(file);
    const failure = parse_failure(text);

    if (failure !== undefined) {
      console.error(file + ": " + failure);
      failed += 1;
      continue;
    }

    const formatted = format_text(text);

    if (formatted === text) {
      continue;
    }

    changed += 1;

    if (check) {
      console.log(file);
    } else {
      await Deno.writeTextFile(file, formatted);
      console.log("Formatted " + file);
    }
  }

  if (failed > 0) {
    return 1;
  }

  return check && changed > 0 ? 1 : 0;
}

async function run_check(args: string[]): Promise<number> {
  const paths = args.filter((arg) => !arg.startsWith("--"));

  if (paths.length === 0) {
    console.error(usage.trimEnd());
    return 1;
  }

  const files = await collect_files(paths);
  let failed = 0;

  for (const file of files) {
    const text = await Deno.readTextFile(file);
    const failure = parse_failure(text);

    if (failure !== undefined) {
      console.error(file + ": " + failure);
      failed += 1;
    }
  }

  return failed > 0 ? 1 : 0;
}

function parse_failure(text: string): string | undefined {
  try {
    Source.parse(text);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function collect_files(paths: string[]): Promise<string[]> {
  const files: string[] = [];

  for (const path of paths) {
    const info = await Deno.stat(path);

    if (info.isFile) {
      files.push(path);
      continue;
    }

    const pending = [path];

    while (pending.length > 0) {
      const directory = pending.pop();

      if (directory === undefined) {
        continue;
      }

      for await (const entry of Deno.readDir(directory)) {
        if (entry.name.startsWith(".")) {
          continue;
        }

        const entry_path = directory + "/" + entry.name;

        if (entry.isDirectory) {
          pending.push(entry_path);
        } else if (entry.name.endsWith(".ix")) {
          files.push(entry_path);
        }
      }
    }
  }

  files.sort();
  return files;
}

async function read_all(
  readable: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;

  for await (const chunk of readable) {
    chunks.push(chunk);
    length += chunk.length;
  }

  const combined = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return combined;
}

async function write_stdout(text: string): Promise<void> {
  const writer = Deno.stdout.writable.getWriter();
  await writer.write(new TextEncoder().encode(text));
  writer.releaseLock();
}

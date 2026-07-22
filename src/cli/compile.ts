import type { FunctionalWasmHostValue } from "../../../gpufuck/functional.ts";
import { DuckCompiler } from "../compiler.ts";

type CompileRequest = {
  input_path: string;
  host_interface: string | undefined;
};

type BuildRequest = CompileRequest & {
  output_directory: string;
};

export async function run_build(args: string[]): Promise<number> {
  const request = parse_build_request(args);
  const compiler = await DuckCompiler.create();

  try {
    const wasm = await compiler.compile_file(request.input_path, {
      host_interface: request.host_interface,
    });
    const output_path = join_path(
      request.output_directory,
      source_stem(request.input_path) + ".wasm",
    );
    await Deno.mkdir(request.output_directory, { recursive: true });
    await Deno.writeFile(output_path, wasm);
    console.log(output_path);
    return 0;
  } finally {
    compiler.destroy();
  }
}

export async function run_source(args: string[]): Promise<number> {
  const request = parse_compile_request(args, "run");
  const compiler = await DuckCompiler.create();

  try {
    const execution = await compiler.run_file(request.input_path, {
      host_interface: request.host_interface,
    });
    const output = format_value(execution.value);
    if (output !== undefined) {
      console.log(output);
    }
    return 0;
  } finally {
    compiler.destroy();
  }
}

function parse_build_request(args: string[]): BuildRequest {
  let output_directory = "build";
  const compile_args: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--out") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("--")) {
        throw new Error("--out expects an output directory");
      }

      output_directory = value;
      index += 1;
      continue;
    }

    if (argument === undefined) {
      throw new Error("Missing build argument " + index.toString());
    }

    compile_args.push(argument);
  }

  return {
    ...parse_compile_request(compile_args, "build"),
    output_directory,
  };
}

function parse_compile_request(
  args: string[],
  command: "build" | "run",
): CompileRequest {
  let input_path: string | undefined;
  let host_interface: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--host-interface") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("--")) {
        throw new Error("--host-interface expects a .duck file");
      }

      host_interface = value;
      index += 1;
      continue;
    }

    if (argument === undefined) {
      throw new Error("Missing " + command + " argument " + index.toString());
    }

    if (argument.startsWith("--")) {
      throw new Error("Unknown " + command + " option: " + argument);
    }

    if (input_path !== undefined) {
      throw new Error(
        command + " expects one input file, got " + input_path + " and " +
          argument,
      );
    }

    input_path = argument;
  }

  if (input_path === undefined) {
    throw new Error(command + " expects an input .duck file");
  }

  return { input_path, host_interface };
}

function source_stem(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const file = path.slice(slash + 1);
  const dot = file.lastIndexOf(".");

  if (dot <= 0) {
    return file;
  }

  return file.slice(0, dot);
}

function join_path(directory: string, file: string): string {
  if (directory.endsWith("/") || directory.endsWith("\\")) {
    return directory + file;
  }

  return directory + "/" + file;
}

function format_value(value: FunctionalWasmHostValue): string | undefined {
  if (value.kind === "unit") {
    return undefined;
  }

  if (
    value.kind === "integer" || value.kind === "signed-integer-64" ||
    value.kind === "float-32" || value.kind === "float-64" ||
    value.kind === "boolean"
  ) {
    return value.value.toString();
  }

  if (value.kind === "text") {
    return value.value;
  }

  return Deno.inspect(value, { colors: false });
}

import { type DuckHostValue, type DuckInit } from "../../src/compiler.ts";

const enter_terminal = new TextEncoder().encode("\x1b[?1049h\x1b[?25l");
const leave_terminal = new TextEncoder().encode(
  "\x1b[0m\x1b[?25h\x1b[?1049l",
);

export type EditorRunner = {
  init: DuckInit;
  dispose: () => void;
};

export type MockEditorRunner = EditorRunner & {
  frames: Uint8Array[];
  saves: Uint8Array[];
};

export function live_runner(path: string): EditorRunner {
  if (!Deno.stdin.isTerminal() || !Deno.stdout.isTerminal()) {
    throw new Error("The editor requires terminal stdin and stdout");
  }

  const terminal = create_live_terminal(path);
  Deno.stdin.setRaw(true);

  try {
    Deno.stdout.writeSync(enter_terminal);
    return create_runner(terminal, () => {
      try {
        Deno.stdout.writeSync(leave_terminal);
      } finally {
        Deno.stdin.setRaw(false);
      }
    });
  } catch (error) {
    try {
      Deno.stdout.writeSync(leave_terminal);
    } finally {
      Deno.stdin.setRaw(false);
    }

    throw error;
  }
}

export function mock_runner(
  initial: Uint8Array,
  keys: Uint8Array[],
): MockEditorRunner {
  const frames: Uint8Array[] = [];
  const saves: Uint8Array[] = [];
  let next_key = 0;
  const terminal = {
    $resource: resource_value,
    load(): DuckHostValue {
      return bytes_value(initial.slice());
    },
    read(): DuckHostValue {
      const key = keys[next_key];

      if (key === undefined) {
        return union_value("ReadResult", "End", unit_value);
      }

      next_key += 1;
      return union_value("ReadResult", "Keys", bytes_value(key.slice()));
    },
    write(value: DuckHostValue): DuckHostValue {
      frames.push(expect_bytes(value, "Terminal.write frame").slice());
      return unit_value;
    },
    save(value: DuckHostValue): DuckHostValue {
      saves.push(expect_bytes(value, "Terminal.save contents").slice());
      return union_value("SaveResult", "Ok", unit_value);
    },
    columns(): DuckHostValue {
      return integer_value(80);
    },
    rows(): DuckHostValue {
      return integer_value(24);
    },
  };
  const runner = create_runner(terminal, () => undefined);
  return { ...runner, frames, saves };
}

function create_live_terminal(path: string): DuckInit["Terminal"] {
  return {
    $resource: resource_value,
    load(): DuckHostValue {
      try {
        return bytes_value(Deno.readFileSync(path));
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          return bytes_value(new Uint8Array());
        }

        throw error;
      }
    },
    read(): DuckHostValue {
      const buffer = new Uint8Array(64);
      const read = Deno.stdin.readSync(buffer);

      if (read === null) {
        return union_value("ReadResult", "End", unit_value);
      }

      return union_value(
        "ReadResult",
        "Keys",
        bytes_value(buffer.slice(0, read)),
      );
    },
    write(value: DuckHostValue): DuckHostValue {
      Deno.stdout.writeSync(expect_bytes(value, "Terminal.write frame"));
      return unit_value;
    },
    save(value: DuckHostValue): DuckHostValue {
      try {
        Deno.writeFileSync(path, expect_bytes(value, "Terminal.save contents"));
        return union_value("SaveResult", "Ok", unit_value);
      } catch {
        return union_value("SaveResult", "Err", unit_value);
      }
    },
    columns(): DuckHostValue {
      return integer_value(Deno.consoleSize().columns);
    },
    rows(): DuckHostValue {
      return integer_value(Deno.consoleSize().rows);
    },
  };
}

function create_runner(
  terminal: DuckInit["Terminal"],
  dispose_terminal: () => void,
): EditorRunner {
  let disposed = false;

  return {
    init: { Terminal: terminal },
    dispose(): void {
      if (disposed) {
        return;
      }

      disposed = true;
      dispose_terminal();
    },
  };
}

function expect_bytes(value: DuckHostValue, subject: string): Uint8Array {
  if (value.kind !== "bytes") {
    throw new Error(subject + " must be Bytes, received " + value.kind);
  }

  return value.value;
}

function bytes_value(value: Uint8Array): DuckHostValue {
  return { kind: "bytes", value };
}

function integer_value(value: number): DuckHostValue {
  return { kind: "integer", value };
}

function union_value(
  type_name: string,
  case_name: string,
  field: DuckHostValue,
): DuckHostValue {
  return {
    kind: "constructor",
    name: "duck::$DuckUnion:" + type_name + ":" + case_name,
    fields: [field],
  };
}

const resource_value: DuckHostValue = { kind: "resource", id: 1 };
const unit_value: DuckHostValue = { kind: "unit" };

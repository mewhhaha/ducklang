import { assert_equals } from "../../src/assert.ts";
import {
  type IxEffectObject,
  type IxValue,
  Source,
} from "../../src/frontend.ts";
import { main } from "./grep.ts";
import { mock_runner } from "./host.ts";

const source_url = new URL("./grep.ix", import.meta.url);
const host_interface_url = new URL("./host.ix", import.meta.url);
const fixture_url = new URL("./fixtures/input.txt", import.meta.url);

Deno.test("grep case study exposes the typed byte-stream host contract", () => {
  const artifact = Source.artifact_file(source_url.href, {
    host_interface: host_interface_url.href,
  });

  assert_equals(artifact.abi.target.profile, "core-3-nonweb");
  assert_equals(Object.keys(artifact.abi.effects), [
    "Process",
    "Walk",
    "FileReader",
    "Stdin",
    "Stdout",
    "Stderr",
  ]);
  assert_equals(
    artifact.abi.effects.FileReader?.operations.read?.result,
    {
      type: { tag: "named", name: "read_result_type" },
      ownership: "unique_heap",
    },
  );
  assert_equals(
    artifact.abi.effects.Stdout?.operations.write?.params,
    [{ type: { tag: "bytes" }, ownership: "bounded_borrow" }],
  );
  const read_result = artifact.abi.types.read_result_type;
  assert_equals(read_result.tag, "union");

  if (read_result.tag !== "union") {
    throw new Error("Expected read_result_type union ABI");
  }

  assert_equals(read_result.cases[0]?.payload, { tag: "bytes" });
});

Deno.test("grep case study copies a file chunk through the mock runner", async () => {
  const input = new Uint8Array([0, 255, 10, 65]);
  const runner = mock_runner({
    args: ["input.bin"],
    files: { "input.bin": input },
  });

  try {
    assert_equals(await main(runner), { code: 0 });
    assert_equals(Array.from(concat_chunks(runner.stdout)), [0, 255, 10, 65]);
    assert_equals(runner.stderr, []);
  } finally {
    runner.dispose();
  }
});

Deno.test("mock FileReader streams chunks and reports EOF", () => {
  const runner = mock_runner({
    args: [],
    files: { "input.bin": new Uint8Array([1, 2, 3]) },
  });

  try {
    assert_equals(call(runner.init.file_reader, "open", "input.bin"), {
      tag: "ok",
    });
    assert_equals(
      call(runner.init.file_reader, "read", 2),
      { tag: "chunk", value: new Uint8Array([1, 2]) },
    );
    assert_equals(
      call(runner.init.file_reader, "read", 2),
      { tag: "chunk", value: new Uint8Array([3]) },
    );
    assert_equals(call(runner.init.file_reader, "read", 2), { tag: "eof" });
    assert_equals(call(runner.init.file_reader, "close"), undefined);
  } finally {
    runner.dispose();
  }
});

Deno.test("mock Walk yields raw DFS events and honors prune", () => {
  const runner = mock_runner({
    args: [],
    files: {
      "root/a.txt": new Uint8Array([1]),
      "root/sub/b.txt": new Uint8Array([2]),
    },
  });

  try {
    assert_equals(call(runner.init.walk, "begin", "root"), { tag: "ok" });
    assert_equals(event_tag(call(runner.init.walk, "next")), "enter");
    assert_equals(event_path(call(runner.init.walk, "next")), "root/a.txt");
    assert_equals(event_tag(call(runner.init.walk, "next")), "enter");
    assert_equals(call(runner.init.walk, "prune"), undefined);
    assert_equals(event_tag(call(runner.init.walk, "next")), "leave");
    assert_equals(event_path(call(runner.init.walk, "next")), "root");
    assert_equals(call(runner.init.walk, "next"), { tag: "done" });
  } finally {
    runner.dispose();
  }
});

Deno.test("live grep runner copies the fixture to stdout", async () => {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-run=wat2wasm",
      new URL("./grep.ts", import.meta.url).href,
      fixture_url.pathname,
    ],
    cwd: new URL("../../", import.meta.url),
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();

  if (!output.success) {
    throw new Error(new TextDecoder().decode(output.stderr));
  }

  assert_equals(
    new TextDecoder().decode(output.stdout),
    await Deno.readTextFile(fixture_url),
  );
  assert_equals(new TextDecoder().decode(output.stderr), "");
});

function call(
  effect: IxEffectObject,
  name: string,
  ...args: IxValue[]
): IxValue {
  const handler = effect[name];

  if (typeof handler !== "function") {
    throw new Error("Missing mock effect method: " + name);
  }

  return handler.apply(effect, args);
}

function concat_chunks(chunks: Uint8Array[]): Uint8Array {
  let length = 0;

  for (const chunk of chunks) {
    length += chunk.byteLength;
  }

  const result = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

function event_tag(value: IxValue): string {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    value instanceof Uint8Array || !("tag" in value) ||
    typeof value.tag !== "string"
  ) {
    throw new Error("Expected walk event");
  }

  return value.tag;
}

function event_path(value: IxValue): string {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    value instanceof Uint8Array || !("value" in value)
  ) {
    throw new Error("Expected walk event payload");
  }

  const payload = value.value;

  if (
    typeof payload !== "object" || payload === null || Array.isArray(payload) ||
    payload instanceof Uint8Array || !("path" in payload) ||
    typeof payload.path !== "string"
  ) {
    throw new Error("Expected walk event path");
  }

  return payload.path;
}

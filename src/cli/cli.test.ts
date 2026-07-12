import { assert_equals } from "../assert.ts";
import { LspTestClient } from "../lsp/test_harness.ts";

const entry = new URL("../../ix.ts", import.meta.url).pathname;

Deno.test("ix fmt --stdin formats a program", async () => {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--no-check", entry, "fmt", "--stdin"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = command.spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode("let  a=1\na\n"));
  await writer.close();
  const output = await child.output();
  assert_equals(output.success, true);
  assert_equals(new TextDecoder().decode(output.stdout), "let a = 1\na\n");
});

Deno.test("ix lsp answers an initialize and formatting round trip", async () => {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--no-check", entry, "lsp"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const client = new LspTestClient(command.spawn());

  await client.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {},
  });
  await client.send({ jsonrpc: "2.0", method: "initialized", params: {} });
  await client.send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: {
      textDocument: {
        uri: "file:///demo.ix",
        languageId: "ix",
        version: 1,
        text: "let  answer=41+1\nanswer\n",
      },
    },
  });
  await client.send({
    jsonrpc: "2.0",
    id: 2,
    method: "textDocument/formatting",
    params: {
      textDocument: { uri: "file:///demo.ix" },
      options: { tabSize: 2, insertSpaces: true },
    },
  });
  await client.send({ jsonrpc: "2.0", id: 3, method: "shutdown" });
  await client.send({ jsonrpc: "2.0", method: "exit" });

  const output = await client.finish();
  assert_equals(output.success, true);
  // deno-lint-ignore no-explicit-any
  const messages = output.messages as any[];

  const initialize = messages.find((message) => message.id === 1);
  assert_equals(
    initialize?.result?.capabilities?.documentFormattingProvider,
    true,
  );

  const diagnostics = messages.find(
    (message) => message.method === "textDocument/publishDiagnostics",
  );
  assert_equals(diagnostics?.params?.diagnostics, []);

  const formatting = messages.find((message) => message.id === 2);
  assert_equals(
    formatting?.result?.[0]?.newText,
    "let answer = 41 + 1\nanswer\n",
  );
});

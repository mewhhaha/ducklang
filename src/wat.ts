export type Wat = string;

export function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);

  return text
    .split("\n")
    .map((line) => line.length === 0 ? line : pad + line)
    .join("\n");
}

export function main(body: Wat): Wat {
  return `
(module
  (func $main (result i32)
${indent(body, 4)}
  )

  (export "main" (func $main))
)
`.trimStart();
}

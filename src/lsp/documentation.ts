export function attached_documentation(
  text: string,
  definition_start: number,
): string | undefined {
  const definition_line = text.lastIndexOf("\n", definition_start - 1) + 1;
  let cursor = definition_line;
  const lines: string[] = [];

  while (cursor > 0) {
    const previous_end = cursor - 1;
    const previous_start = text.lastIndexOf("\n", previous_end - 1) + 1;
    const line = text.slice(previous_start, previous_end).trim();

    if (!line.startsWith("//")) {
      break;
    }

    let content = line.slice(2);

    if (content.startsWith("/")) {
      content = content.slice(1);
    }

    lines.unshift(content.trim());
    cursor = previous_start;
  }

  if (lines.length === 0) {
    return undefined;
  }

  return lines.join("\n");
}

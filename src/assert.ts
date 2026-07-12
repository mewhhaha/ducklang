export function assert_equals(
  actual: unknown,
  expected: unknown,
  message?: string,
): void {
  const actual_text = Deno.inspect(actual, { depth: 100, sorted: true });
  const expected_text = Deno.inspect(expected, { depth: 100, sorted: true });

  if (actual_text !== expected_text) {
    let prefix = "";
    if (message) {
      prefix = message + "\n\n";
    }
    throw new Error(
      prefix + "Expected:\n" + expected_text + "\n\nActual:\n" +
        actual_text,
    );
  }
}

export function assert_includes(actual: string, expected: string): void {
  if (!actual.includes(expected)) {
    throw new Error(
      "Expected text to include:\n" + expected + "\n\nActual:\n" + actual,
    );
  }
}

export function assert_throws(fn: () => unknown, message: string): void {
  let thrown = false;

  try {
    fn();
  } catch (error) {
    thrown = true;

    if (!(error instanceof Error)) {
      throw new Error("Expected Error instance");
    }

    if (!error.message.includes(message)) {
      throw new Error(
        "Expected error message to include:\n" + message +
          "\n\nActual:\n" + error.message,
      );
    }
  }

  if (!thrown) {
    throw new Error("Expected function to throw");
  }
}

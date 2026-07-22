import { DuckCompiler } from "../compiler.ts";

export async function run_tests(args: string[]): Promise<number> {
  if (args.length !== 1 || args[0] === undefined) {
    throw new Error("test expects one input .duck file");
  }

  const compiler = await DuckCompiler.create();

  try {
    const results = await compiler.test_file(args[0]);
    let failed = 0;

    for (const result of results) {
      if (result.status === "passed") {
        console.log("pass " + result.name);
        continue;
      }

      failed += 1;
      console.error("fail " + result.name + ": " + result.message);
    }

    const passed = results.length - failed;
    let test_label = "tests";

    if (results.length === 1) {
      test_label = "test";
    }

    console.log(
      results.length.toString() + " " + test_label + ", " +
        passed.toString() + " passed, " + failed.toString() + " failed",
    );

    if (failed > 0) {
      return 1;
    }

    return 0;
  } finally {
    compiler.destroy();
  }
}

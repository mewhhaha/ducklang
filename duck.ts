import { run_cli } from "./src/cli/main.ts";

Deno.exit(await run_cli(Deno.args));

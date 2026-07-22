# Modular compiler workload

`main.duck` imports four parameterized Duck modules. The mixer, sequence, and
folder modules derive constants for three recursive numerical kernels, while the
pipeline module sets their seed and iteration count. Each kernel runs for 512
rounds and relies on i32 wrapping behavior.

Compile the modular program through the canonical gpufuck target:

```sh
deno task compiler experiments/gpufuck/workload/main.duck
```

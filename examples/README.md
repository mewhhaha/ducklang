# Source Examples

These are small source-language programs. They use `.txt` because the project
does not have a dedicated source-file extension yet.

| File | Shows | Path |
| --- | --- | --- |
| `01_arithmetic_and_shadowing.txt` | same-type shadowing | IC |
| `02_comptime_adder.txt` | compile-time closure creation | IC |
| `03_recursive_fib.txt` | recursive source function | IC WAT |
| `04_struct_fields.txt` | typed struct construction and field reads | Core WAT |
| `05_union_match.txt` | typed union construction and `if let` | Core WAT |
| `06_text_bytes.txt` | visible text append, length, and indexing | Core WAT |
| `07_range_loop.txt` | range loop and assignment shadowing | Core WAT |
| `08_higher_order_compose.txt` | higher-order compile-time composition | IC |
| `09_const_parameter_twice.txt` | `const` call-site specialization | IC |
| `10_dynamic_branch_score.txt` | open dynamic branch lowering | IC |
| `11_i64_pipeline.txt` | explicit `I64` arithmetic | IC |
| `12_closure_capture.txt` | closure capture before shadowing | IC |
| `13_projected_struct_update.txt` | projected struct update | Core WAT |
| `14_dynamic_union_result.txt` | dynamic typed union branch and match | Core WAT |
| `15_text_slices.txt` | visible text slicing and byte reads | Core WAT |
| `16_text_byte_loop.txt` | collection loop over visible text bytes | Core WAT |
| `17_type_pattern_check.txt` | compile-time type pattern check | Core WAT |

`IC` means the program can be run through `Source.compile`. `IC WAT` means it
targets `Source.ic_wat`. `Core WAT` means it targets `Source.wat`.

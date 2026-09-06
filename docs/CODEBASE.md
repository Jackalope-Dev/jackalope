# Local codebase maps

Open Project → Codebase and choose **Analyze repository**. The native scanner reads the
selected project's current files without starting agents, invoking package
scripts, or sending source over the network. Refresh after editing or changing
branches. A snapshot stays in memory while the view is open; Export saves its
files, references, source line numbers, diagnostics and dependency cycles as JSON.

The initial graph groups files into directories. Click a directory or focus it
and press Enter to drill down. The file list and search give another route to
any file. Selecting a file shows direct incoming/outgoing neighbors and the full
reference lists below the graph. Arrows point from the importing file to its
dependency. Zoom and Fit view are available; graph rendering is bounded to 60
nodes with visible truncation. The file list remains paginated and searchable.

## Analysis coverage

- JavaScript/JSX and TypeScript/TSX/MTS/CTS: Tree-sitter extracts imports,
  re-exports, literal dynamic imports and require calls. Comments and arbitrary
  strings do not create edges. A shadowed require binding is not distinguished.
- Relative paths resolve against the scanned file inventory, using common
  source extensions, TypeScript equivalents of JavaScript extensions, and index
  files. This is a bounded source resolver, not a complete Node/bundler/compiler
  resolver. Oxc reads tsconfig/package metadata to resolve aliases and installed workspace packages,
  without executing configuration or scripts. Only scanned local files become graph nodes.
- Rust: external file module declarations use ordinary module.rs/module/mod.rs
  layout. Crate/self/super use statements, including grouped imports, resolve to declared
  external file modules. Inline or custom-path modules, macros, symbol-level reexports
  and conditional compilation remain incomplete.
- Other languages, documents, assets and manifests appear in the file inventory.
  Language labels do not imply import-analysis support.
- References outside the scanned inventory and unresolved packages/aliases remain explicit.
  Computed imports and custom references are unsupported. Cross-language call graphs
  and runtime symbol resolution are outside this source map.
- Task review offers a changed-file impact check using reverse resolved references.
  Deleted/generated files and partial scans limit coverage; this never substitutes for tests.

Cycles are strongly connected groups computed from resolved file imports with
Petgraph's iterative Kosaraju algorithm. Type-only and dynamic imports are
included. A cycle is a review candidate, not proof of a runtime bug. Missing
relative references may be generated, excluded, or custom-resolved. Syntax notes
can reflect parser coverage rather than compiler errors. Partial scans cannot
establish the absence of cycles or missing dependencies across the whole project.

## Resource and lifecycle bounds

The `ignore` walker respects repository ignore rules without global/parent ignore
configuration. It skips symlinks and dependency/build/output directories,
including node_modules, target, vendor, .worktrees, dist and output. Source reads
are canonicalized under the selected root and bounded to 512 KiB per file.
Limits are 6,000 inventoried files, 32 MiB of analyzed source and 30,000 references.
An elapsed-time budget of 20 seconds is checked between entries/files; each
parser also has a 100 ms timeout. Slow filesystem calls are not forcibly canceled.
Resolver configuration reads are separately bounded to 512 KiB per file, 32 MiB total,
20 seconds, and the canonical repository root. Limits and partial parse/read failures remain visible. Only one native scan runs
at a time, on a blocking worker; leaving/changing projects discards late UI results.
A failed refresh preserves the previous snapshot with a visible error.

## Public dependencies

Versions and license declarations were checked against installed package/crate
metadata. Lockfiles retain exact transitive versions.

| Dependency | Version | License | Responsibility / upstream |
| --- | --- | --- | --- |
| oxc_resolver | 11.24.3 | MIT | [Oxc](https://docs.rs/oxc_resolver/latest/oxc_resolver/), tsconfig and package resolution |
| dunce | 1.0.5 | CC0-1.0 | Windows canonical path normalization for resolver discovery |
| @xyflow/react | 12.11.6 | MIT | [React Flow](https://reactflow.dev/learn/advanced-use/accessibility), pan/zoom, graph rendering and keyboard primitives |
| @dagrejs/dagre | 3.1.1 | MIT | [Dagre](https://github.com/dagrejs/dagre), directed graph layout |
| tree-sitter | 0.25.10 | MIT | [Tree-sitter](https://github.com/tree-sitter/tree-sitter), native syntax parsing |
| tree-sitter-typescript | 0.23.2 | MIT | [TypeScript/TSX grammar](https://github.com/tree-sitter/tree-sitter-typescript) |
| tree-sitter-javascript | 0.25.0 | MIT | [JavaScript grammar](https://github.com/tree-sitter/tree-sitter-javascript) |
| tree-sitter-rust | 0.24.2 | MIT | [Rust grammar](https://github.com/tree-sitter/tree-sitter-rust) |
| ignore | 0.4.33 | Unlicense OR MIT | [Ripgrep's walker](https://github.com/BurntSushi/ripgrep), ignore-aware discovery |
| petgraph | 0.8.3 | MIT OR Apache-2.0 | [Iterative cycle analysis](https://docs.rs/petgraph/latest/petgraph/algo/scc/kosaraju_scc/fn.kosaraju_scc.html), without recursive browser stack limits |

The map UI and its graph libraries load only when Codebase is opened. No hosted
analysis service or installed Node/Python toolchain is needed for native scans.

## Verification

`pnpm --filter @jackalope/desktop test` includes graph aggregation, direction,
filtering, rendering limits, selected-file retention, empty input and unusual
path tests. Native tests cover parsed imports versus comments/strings, source
extension precedence, index resolution, Rust modules, ignored/oversized files,
partial syntax, deterministic output, missing roots, cycles/self imports and
6,000-file dependency chains, tsconfig aliases, Rust grouped use declarations and
separate import/require package-export conditions.

Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` and
`pnpm build`. The ignored `export_repository_scan` test can write an actual scan
for UI review when `JACKALOPE_SCAN_ROOT` and `JACKALOPE_SCAN_OUTPUT` are explicitly
set to a repository and an output JSON file. Browser review uses that native
output as an IPC fixture; it is not evidence of a packaged WebView scan/export.
No synthetic maps or fixture data are shipped in the application.

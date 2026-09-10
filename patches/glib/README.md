# GLib compatibility patch

This is the published `glib` 0.18.5 crate, with the two-line
[upstream fix](https://github.com/gtk-rs/gtk-rs-core/pull/1343) for
[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html).
`VariantStrIter::impl_get` passes a mutable output pointer to GLib.

The Linux Tauri/GTK dependency graph requires the 0.18 series. Keep this Cargo
override until that graph supports a fixed upstream version. The upstream source,
tests, MIT license and copyright are retained; generation-only GIR configuration
and registry bookkeeping are omitted. `pnpm check:dependencies` verifies the
patched file and the locked source override before running dependency audits.

Do not edit vendored code without updating its provenance check. Run the upstream
variant iterator tests on Linux with GLib development libraries installed:

```sh
cargo test --manifest-path patches/glib/Cargo.toml --release variant_iter
```

# whisper-rs-sys build patch

This is the published `whisper-rs-sys` 0.15.0 crate, including its bundled
whisper.cpp sources, with one change in `build.rs`: `add_link_search_path` declares
only folders that contain a built library instead of every folder under the CMake
build directory.

The published script declared about 40 search folders. Cargo adds search folders
inside the target directory to `PATH` when it runs tests and binaries on Windows,
which pushed `PATH` past the 8191 characters `cmd.exe` reads, so every command the
tests spawned failed to start. Linking is unchanged: the static libraries live in the
folders that are still declared.

Keep this Cargo override until a `whisper-rs-sys` release limits its search folders.
`pnpm check:dependencies` verifies every retained file against `provenance.json` and
that Cargo selects this source. Biome skips this folder. Do not edit vendored code
without updating its provenance manifest.

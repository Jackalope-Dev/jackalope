# faster-hex dependency patch

This is the published `faster-hex` 0.10.1 crate with one change: its manifest no
longer declares `heapless` 0.8. `faster-hex` uses `heapless` only when its `alloc`
feature is off, but the published manifest pulls it in unconditionally, so the
lockfile carried `heapless` 0.8.0 and its unsound advisories (RUSTSEC-2026-0574
through RUSTSEC-2026-0582, fixed in 0.9.4).

Jackalope reaches `faster-hex` through `gix-hash`, which enables `std` and therefore
`alloc`, so no `heapless` code was ever compiled into the app. Building this copy
without `alloc` fails to compile rather than silently using `heapless`.

Keep this Cargo override until `gix-hash` depends on a `faster-hex` release that
makes `heapless` optional (1.0 does). The upstream source, build script and MIT
licenses are retained; registry bookkeeping, CI configuration and the upstream
README are omitted. `pnpm check:dependencies` verifies every retained file against
`provenance.json` and that Cargo selects this source.

Do not edit vendored code without updating its provenance manifest.

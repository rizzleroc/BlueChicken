# whipgen issue: `saveTo` silently rewritten to outDir (blocks downstream pipelines)

**Tag**: `punchlist_outsideinput`

**Tool**: `whipgen_generate_image` (chatgpt image-gen). Likely also affects `whipgen_gemini_generate_image`, `whipgen_asim_generate_image`, `whipgen_generate_batch`.

**Daemon**: version `0.1.0`, commit `aa1da3e` (uptime when observed: ~2h45m).

## Summary

The `saveTo` parameter on `whipgen_generate_image` is silently rewritten to the daemon's outDir, regardless of what the caller passed. The schema documents `saveTo` as an honored override, but the daemon ignores it and writes to `<outDir>/<name>.png` every time. This breaks composability with `whipgen_touch_generate`, which requires inputs to live under a *different* allowed-read root.

## Observed behavior

1. Call `whipgen_generate_image` with `name: "bc-3di-aurora"`, `saveTo: "C:\\Users\\guru8\\bc-3di-aurora.png"`, `prompt: "..."`. Daemon outDir is `F:\whipgen-mcp\whipgen-out`.
2. The MCP sync response carries `path: "F:\\whipgen-mcp\\whipgen-out\\bc-3di-aurora.png"` — **not** the path I requested.
3. `whipgen_job_status` on the same job shows `historyEntry.args.saveTo: "F:\\whipgen-mcp\\whipgen-out\\bc-3di-aurora.png"` — confirming the daemon literally **rewrote my input arg**, not just chose where to save.
4. Subsequent `whipgen_touch_generate` with `imagePath: "C:\\Users\\guru8\\bc-3di-aurora.png"` errors: `ENOENT: no such file or directory, open 'C:\\Users\\guru8\\bc-3di-aurora.png'`. File is on disk only at the daemon's outDir.

Repro is consistent across `async: true` and `async: false`, across multiple names, with and without `force: true`.

## Expected behavior

Per the schema for `whipgen_generate_image`:

> `saveTo`: Optional absolute path under `WHIPGEN_ALLOWED_WRITE_ROOTS`. When set, the daemon writes the PNG and the polled result carries `savedTo` instead of base64.

I expected my `saveTo: "C:\\Users\\guru8\\..."` to either:
- be honored (file written there, result carries that path), or
- be rejected loudly with `save_to_outside_allowed_roots` if the path isn't under an allowed write root.

Silently rewriting the arg is the worst of three options.

## Impact

This blocks **any pipeline that needs an image from one tool to be readable by another tool with a different allowed-read root** — most notably the documented image → 3D workflow:

- `whipgen_generate_image` writes only under daemon's outDir (`F:\whipgen-mcp\whipgen-out`).
- `whipgen_touch_generate`'s allowed read roots are `C:\Users\guru8` only.
- The two never overlap, and there's no MCP-side tool to copy/move files between roots.

Net effect: from an MCP client that doesn't have direct disk access to the daemon's host (e.g. a remote Claude container), the chatgpt → tripo pipeline is unreachable.

Same family of issue would apply to any planned hand-off between providers whose roots are configured separately.

## Suggested fixes (any of these unblocks)

1. **Honor `saveTo` when supplied**, fall back to `<outDir>/<name>.png` otherwise. Validate against `WHIPGEN_ALLOWED_WRITE_ROOTS` and return `save_to_outside_allowed_roots` if the path isn't allowed (this error code already exists in the catalog).
2. **Union the allowed-read roots across providers** so anything written by the daemon is at least readable by touch / asim / etc. by default.
3. **Add `whipgen_copy_asset({ name, toPath })`** (or `whipgen_export_asset`) that moves/copies an existing asset out of outDir into another allowed-write root. Minimal surface for callers that need to bridge across roots.
4. **At minimum**, update the schema to reflect the actual behavior so callers don't waste cycles trying to override the save location.

## Useful job ids (for daemon-side log lookup)

All in session `s_mplh89wk_41951af3`, ownerLabel `whipgen-out:<name>`:

| Job | Call | resultSize | Observation |
|---|---|---|---|
| `jmplmwife_q` | `bc-3di-aurora` async, `saveTo: C:\Users\guru8\bc-3di-aurora.png` | 299 (path only) | args.saveTo rewritten to F:\ in history |
| `jmpln2utw_10` | `bc-syncsave-test` sync, `saveTo: C:\Users\guru8\bc-syncsave-test.png` | (response shows `path: F:\...`) | sync path also rewritten |
| `jmpln06cq_1` | `whipgen_touch_generate` from `C:\Users\guru8\bc-3di-aurora.png` | error: ENOENT | confirms file isn't where I asked it to be |

## Minimal repro

```js
// In an MCP session whose container can't see the daemon's host disk:
await whipgen_generate_image({
  name: "bridge-repro",
  prompt: "a small circle",
  width: 256, height: 256,
  saveTo: "C:\\Users\\guru8\\bridge-repro.png", // any path under an allowed-read root for some other provider
});
// Response shows path: F:\whipgen-mcp\whipgen-out\bridge-repro.png — not C:\Users\guru8\...
await whipgen_touch_generate({
  type: "image",
  imagePath: "C:\\Users\\guru8\\bridge-repro.png",
});
// Errors: ENOENT: no such file or directory
```

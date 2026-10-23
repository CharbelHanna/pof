# @pof/tsconfig

Shared TypeScript presets.

| Preset | Used by |
|---|---|
| `base.json` | everything else extends this |
| `portable.json` | `@pof/schemas`, `@pof/api-client` |
| `node.json` | `@pof/db`, `@pof/core`, `@pof/api`, `apps/worker` |
| `react-library.json` | `@pof/ui` |
| `nextjs.json` | `apps/web` |

## Why `portable.json` has `"types": []`

`@pof/schemas` and `@pof/api-client` are the two packages the future Expo app
(Phase 8) will bundle with Metro. The preset deliberately omits `@types/node`
and the Node lib typings, so importing `fs`, `path`, `crypto`, `Buffer` or
`process` in those packages **fails typecheck here and now** — rather than
failing at Metro bundle time, months later, when the mobile app is being built
and the offending import is load-bearing.

Do not add `"node"` to `types` in this preset. If a portable package genuinely
needs a platform capability, inject it as a parameter from the caller instead.

This is enforced in CI by the `portable` typecheck job.

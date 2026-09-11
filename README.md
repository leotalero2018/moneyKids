# Money Kids

A family money app: kids submit invoices for work they've done, parents approve
or counter-offer, and balances move. All amounts are integer minor units — never
floats, never a hardcoded `/100`.

## Workspaces

| Path | What it is |
|---|---|
| `app/` | React + Vite PWA (parent and kid experiences) |
| `functions/` | Cloud Functions — the only path that can move money |
| `packages/shared/` | Money helpers and validation shared by both |
| `packages/rules-tests/` | Firestore and Storage security-rules tests |
| `e2e/` | Playwright, mobile viewport, against the emulators |

## Local development

```bash
npm ci
npm run emulators      # firestore, auth, functions, storage
npm run dev            # the app, against those emulators
```

Tests:

```bash
npm run typecheck      # all workspaces
npm test               # unit tests
npm run test:rules     # security rules
npm run test:functions # callables, against the emulators
npm run test:app       # component tests
npm run test:e2e       # Playwright
```

Every emulator-backed script builds the functions bundle first, so the staged
artifact is never stale.

## Deploying

**Production deploys run from CI.** `.github/workflows/deploy.yml` fires on merge
to `main` and is the only path that should reach the live project. It passes
`--project` explicitly from `secrets.FIREBASE_PROJECT_ID`, and `--only` so the
deploy surface is always named.

`.firebaserc` deliberately defines **no production alias**. `default` is the dev
project, and the live project is named by its bare id when you need it — every
place that accepts an alias accepts a project id:

```bash
firebase firestore:databases:list --project opsix-kids-money   # read-only, fine
```

An alias would buy nothing but risk: it would put `firebase deploy -P prod` —
rules, indexes and the nine money callables, against real family data — one flag
away for anyone with credentials. Don't run `firebase use` with the production
project either; it makes the target sticky for every later command in that
checkout.

### How the functions bundle is built

Cloud Build runs `npm install` inside `functions.source`, isolated from the npm
workspace, so it cannot resolve the local unpublished `@money-kids/shared`.
`functions/scripts/stage.mjs` therefore generates the artifact Cloud Build
installs: it bundles `src/index.ts` (inlining `shared`) into `functions/deploy/`
alongside a manifest listing only the published runtime externals.

- `functions/scripts/deploy-contract.mjs` is the single place to edit the list of
  callables and the runtime externals.
- `functions/deploy.lock.json` is **committed** and pins the 241-package
  transitive tree the deployed functions run on. Refresh it deliberately:
  ```bash
  npm run stage:lock -w @money-kids/functions
  ```
  `.github/workflows/refresh-deploy-lock.yml` does this weekly and opens a PR
  when the tree moves.
- `functions/deploy/.gitkeep` is committed so the staged directory exists in a
  fresh clone. Deploying after deleting `functions/deploy` does work today —
  firebase-tools runs `predeploy` before validating `functions.source` — but
  that ordering is undocumented, so the tracked empty directory is a hedge
  against it changing.

The build enforces its own invariants (first-party-only inputs, a self-contained
bundle, `shared` surviving tree-shaking, the callable export surface, and
lockfile consistency) and fails rather than deploying something subtly wrong.
`npm run build:deploy` is the strict variant used by the predeploy hook and CI.

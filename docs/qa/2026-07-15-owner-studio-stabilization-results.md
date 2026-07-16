# Owner Studio stabilization verification — 2026-07-16

Branch: `codex/studio-stabilization`

## Acceptance scope

The native Playwright fixture covers the existing ten owner scenarios plus:

- immediate Decision routing, collection persistence after reload, ready connections, trash/restore/permanent deletion;
- honest pending, failed, and unavailable connection-index states;
- a ten-row bounded checkpoint page and compact PDF material inspector;
- a ritual session usable while deterministic AI preparation is still running;
- export progression to a real `.zip` download with the server-projected filename.

The browser trace was used to inspect console/network failures. This exposed and fixed empty JSON `Content-Type` headers on bodyless Studio `POST`, `PUT`, and `DELETE` requests; Fastify had correctly rejected them with `FST_ERR_CTP_EMPTY_JSON_BODY`.

## RED evidence

`pnpm exec playwright test tests/e2e/owner-studio.spec.ts --grep "owner structure"` failed before fixture/test integration because the new decision flow was not addressable through the initial selector. The first combined run also exposed the real bodyless-JSON collection/export contract defect and the stale responsive navigation count after adding Lixeira.

## Verification matrix

Fresh evidence from the final branch run:

- `pnpm test`: exit 0 — shared 17 passed; API 985 passed and 135 environment-conditional skipped; web 541 passed.
- `pnpm typecheck`: exit 0 across shared, API, and web. The first run found one test-mock tuple inference error; the signature was corrected and the full command rerun successfully.
- `pnpm build`: exit 0 across shared, API, and web. Vite emitted only its existing large-chunk advisory.
- `pnpm test:e2e`: exit 0 — 19 Chromium scenarios passed and the 2 production-only scenarios were explicitly skipped because the opt-in variables were absent.
- `docker compose -f docker-compose.prod.yml config >/dev/null`: exit 0. Compose warned that local secret variables were unset and therefore substituted blank validation values; no secret was printed.
- `git diff main...HEAD --check`: exit 0 after the Task 20 commit, covering the complete branch rather than only the pre-commit worktree.

## Environment-dependent release gates

- Production/OpenAI smoke: not run because both `BAASE_PRODUCTION_URL` and `BAASE_PRODUCTION_AUTH_STATE` were absent. Playwright reported both production tests as skipped. A skip is not production-release approval.
- Disposable pgvector migration rehearsal: not run. `docker info` returned server `29.2.1`, but the daemon failed both named-volume creation and image metadata access with `/var/lib/docker/... input/output error`. No user or production volume was touched. The migration-copy and `SELECT extversion` release gates remain unchecked.
- Deployment, deployed smoke, and legacy production-data accessibility remain operator gates in `docs/operations/owner-studio.md`; they cannot truthfully be checked by a local branch run.

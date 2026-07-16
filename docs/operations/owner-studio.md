# Owner Studio: production rollout and rollback

This runbook deploys the Owner Studio without replacing its PostgreSQL or MinIO volumes. Run it from a Swarm manager with the production environment loaded. Never print `OPENAI_API_KEY`, prompts, document bodies, export contents, or owner identifiers in release logs.

## Preconditions

- Publish the API and web images with the same immutable commit tag and set `BAASE_IMAGE_TAG` to that tag (not `latest`).
- Keep `BAASE_STUDIO_AI_MODEL=gpt-5.6-terra`, `BAASE_STUDIO_EMBEDDING_MODEL=text-embedding-3-small`, `BAASE_STUDIO_ENABLED=true`, and `BAASE_STUDIO_VECTOR_ENABLED=true`.
- Keep the external volumes `prymeira_baase_postgres_data` and `prymeira_baase_minio_data`. Record their names before rollout:

```bash
docker volume inspect prymeira_baase_postgres_data prymeira_baase_minio_data --format '{{.Name}}'
docker stack services baase_prymeira
```

Take the normal PostgreSQL backup/snapshot and record the currently deployed API/web image digests as `PREVIOUS_API_IMAGE` and `PREVIOUS_WEB_IMAGE`.

## Disposable migration rehearsal

The rehearsal must restore the latest **sanitized custom-format dump** copied from the production schema/data before applying the candidate migrations. It must not use an empty database and must never connect the migration command to production. The sanitization process must remove account credentials, tokens, document bodies, extracted material text, assistant messages, object keys/URLs, and other private owner content while preserving table shapes, foreign keys, lifecycle states, and representative legacy rows.

Set `BAASE_REHEARSAL_DUMP` to that reviewed `.dump` artifact and use an isolated database and volume:

```bash
test -r "$BAASE_REHEARSAL_DUMP"
project="baase-studio-rehearsal-$(date +%s)"
volume="${project}-data"
docker volume create "$volume"
docker run -d --name "$project" -e POSTGRES_PASSWORD=rehearsal -e POSTGRES_DB=baase -p 127.0.0.1::5432 -v "$volume:/var/lib/postgresql/data" pgvector/pgvector:pg16
port="$(docker port "$project" 5432/tcp | sed 's/.*://')"
until docker exec "$project" pg_isready -U postgres -d baase; do sleep 1; done
docker exec -i "$project" pg_restore --clean --if-exists --no-owner --no-acl -U postgres -d baase < "$BAASE_REHEARSAL_DUMP"
counts_sql="SELECT json_build_object('documents',(SELECT count(*) FROM studio_documents),'assets',(SELECT count(*) FROM studio_assets),'structures',(SELECT count(*) FROM studio_structures),'collections',(SELECT count(*) FROM studio_collections),'versions',(SELECT count(*) FROM studio_document_versions));"
docker exec "$project" psql -U postgres -d baase -Atc "$counts_sql" > /tmp/baase-studio-before.json
DATABASE_URL="postgresql://postgres:rehearsal@127.0.0.1:${port}/baase" pnpm --filter @prymeira/baase-api db:migrate-operational
docker exec "$project" psql -U postgres -d baase -Atc "SELECT extversion FROM pg_extension WHERE extname = 'vector';"
docker exec "$project" psql -U postgres -d baase -Atc "$counts_sql" > /tmp/baase-studio-after.json
diff -u /tmp/baase-studio-before.json /tmp/baase-studio-after.json
legacy_count="$(docker exec "$project" psql -U postgres -d baase -Atc "SELECT count(*) FROM studio_document_versions WHERE is_legacy = true;")"
version_count="$(docker exec "$project" psql -U postgres -d baase -Atc "SELECT count(*) FROM studio_document_versions;")"
test "$legacy_count" -gt 0
test "$legacy_count" -eq "$version_count"
docker rm -f "$project"
docker volume rm "$volume"
```

The pre-migration snapshot intentionally reads only tables and columns that predate migration 27. The migration command and count diff must exit 0, the vector query must return exactly one non-empty version row, and every preserved pre-migration version must be backfilled as `is_legacy = true`. The material, structure, and collection queries must remain readable. Preserve the sanitized dump as release evidence under restricted access; never commit it.

## MinIO bootstrap check

The one-shot bootstrap is idempotent and uses MinIO native stale multipart cleanup. After deployment, it must finish with `complete`, while MinIO remains `1/1`:

```bash
docker service ps baase_prymeira_prymeira_baase_minio_bootstrap --no-trunc
docker service logs baase_prymeira_prymeira_baase_minio_bootstrap --since 10m
docker service ps baase_prymeira_prymeira_baase_minio
```

Do not add an S3 lifecycle XML policy in `minio-native` mode.

## Atomic Swarm deployment

Resolve and validate the exact stack first, then deploy PostgreSQL image configuration, API, bootstrap, and web from the same compose revision:

```bash
test -n "$BAASE_IMAGE_TAG"
docker compose -f docker-compose.prod.yml config > /tmp/baase-owner-studio-stack.yml
docker pull "ghcr.io/yohannreimer/prymeira-baase-api:${BAASE_IMAGE_TAG}"
docker pull "ghcr.io/yohannreimer/prymeira-baase-web:${BAASE_IMAGE_TAG}"
docker stack deploy --with-registry-auth -c /tmp/baase-owner-studio-stack.yml baase_prymeira
docker service ls --filter label=com.docker.stack.namespace=baase_prymeira
```

Wait for PostgreSQL, MinIO, API, and web to reach their intended replica counts. The API applies additive schema migrations at startup; do not scale it up until the single migrated replica is healthy.

## Readiness and safe smoke

Check public runtime readiness without secrets, then run the authenticated owner-only Playwright smoke from a secure auth-state file:

```bash
curl --fail --silent https://baase.prymeiradigital.com.br/api/readiness | jq '{ok,mode,ai,studio,object_storage}'
BAASE_PRODUCTION_URL=https://baase.prymeiradigital.com.br \
BAASE_PRODUCTION_AUTH_STATE=/secure/owner-auth-state.json \
pnpm exec playwright test -c playwright.production.config.ts
```

The dedicated production config starts no local fixture/API/web server. The smoke captures the Bearer header from an authenticated app request without printing it, then reuses it for readiness, disposable document creation, trash, and permanent deletion. In tightly controlled automation, `BAASE_PRODUCTION_BEARER_TOKEN` may provide the same Bearer token explicitly; keep it in the secret store and never put it in command history or logs.

The Studio readiness response must report `ready` for `ai`, `embeddings`, `vector`, and `maintenance`, and must resolve `ai.model` exactly to `gpt-5.6-terra`. The model identifier is safe operational metadata; the private endpoint never includes provider credentials. The Copilot assertion waits for the SSE turn to reach its terminal UI state and validates the terminal response before cleanup. The smoke uses only fixed synthetic text and never logs prompts, responses, tokens, or private content. It exercises the configured `gpt-5.6-terra` path only when both required opt-in variables are present.

After the smoke, manually confirm with the same owner that pre-existing documents, compact materials, structures, collections, and legacy versions open without mutation.

## Rollback

Rollback changes images only. Do not delete tables, buckets, objects, networks, or either external volume:

```bash
docker service update --image "$PREVIOUS_API_IMAGE" --with-registry-auth baase_prymeira_prymeira_baase_api
docker service update --image "$PREVIOUS_WEB_IMAGE" --with-registry-auth baase_prymeira_prymeira_baase_web
docker service rollback baase_prymeira_prymeira_baase_minio_bootstrap || true
docker volume inspect prymeira_baase_postgres_data prymeira_baase_minio_data --format '{{.Name}}'
```

Additive migrations remain in place so the previous application can be restored without destroying owner data. If rollback is caused by a data or migration anomaly, stop the rollout and restore the rehearsed PostgreSQL backup under the incident procedure; never improvise destructive SQL.

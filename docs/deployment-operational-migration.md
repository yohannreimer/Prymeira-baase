# Cutover Operacional do Baase

Este procedimento move a leitura operacional de `baase_records` para as tabelas relacionais sem apagar o legado. Execute-o primeiro em uma copia do banco de producao.

## Antes de Comecar

1. Confirme que a stack possui os volumes externos `prymeira_baase_postgres_data` e `prymeira_baase_minio_data`.
2. Deixe `BAASE_OPERATIONAL_STORE=jsonb` no arquivo de ambiente da stack durante a primeira publicacao do codigo novo.
3. Defina `BAASE_MINIO_ACCESS_KEY` e `BAASE_MINIO_SECRET_KEY` no ambiente da stack. O compose usa essas mesmas credenciais em `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` no MinIO e em `S3_ACCESS_KEY`/`S3_SECRET_KEY` na API e no bootstrap. Nao defina as variaveis `S3_*` externamente: endpoint, regiao, bucket e path-style sao fixos no compose.
4. Faca o deploy da stack normalmente no Portainer. O servico da API cria as tabelas de schema quando o modo relacional for ativado, mas o comando abaixo tambem e idempotente.

O Swarm inicia API, MinIO e bootstrap em paralelo e nao respeita `depends_on` como garantia de ordenacao. O job one-shot `prymeira_baase_minio_bootstrap` executa o comando idempotente `storage:bootstrap`: cria o bucket apenas se estiver ausente e termina depois de verificar o acesso. O MinIO remove uploads multipart incompletos pelo mecanismo nativo do servidor, com expiracao em 24 horas e varredura a cada hora configuradas no compose. A API aguarda a prontidao do bucket por ate 30 tentativas e continua fail-closed se o storage nao ficar pronto. O modo generico para outros provedores S3 continua exigindo lifecycle compativel.

## Backup e Ensaio

Na sua maquina com acesso ao Postgres, exporte a URL de producao sem publica-la em historico ou chat:

```bash
pg_dump "$DATABASE_URL" --format=custom --file=baase-pre-operational.dump
createdb baase_rehearsal
pg_restore --no-owner --dbname="$REHEARSAL_DATABASE_URL" baase-pre-operational.dump
DATABASE_URL="$REHEARSAL_DATABASE_URL" pnpm --filter @prymeira/baase-api db:migrate-operational > operational-report.json
jq '.sourceCounts, .targetCounts, .orphanReferences, .reconciled' operational-report.json
```

O ultimo comando precisa terminar com `reconciled: true`. Referencias orfas aparecem em `orphanReferences`; elas sao convertidas para `Sem area` de forma auditavel, sem expor IDs internos na interface.

Repita o comando de migracao no mesmo banco de ensaio. A segunda execucao deve manter `insertedTotal` em zero para os dados ja processados.

## Corte em Producao

1. Mantenha `BAASE_OPERATIONAL_STORE=jsonb` e publique a imagem nova.
2. Faça o backup do banco de producao com `pg_dump`.
3. Rode uma vez na VPS ou em uma maquina com conectividade segura:

```bash
DATABASE_URL="$DATABASE_URL" pnpm --filter @prymeira/baase-api db:migrate-operational > operational-report-production.json
jq '.sourceCounts, .targetCounts, .orphanReferences, .reconciled' operational-report-production.json
```

4. So prossiga se o relatorio estiver reconciliado e os orfaos estiverem compreendidos.
5. Altere apenas `BAASE_OPERATIONAL_STORE=relational` no ambiente da stack e atualize-a no Portainer.
6. Nos checks do rollout, confirme que a task `prymeira_baase_minio_bootstrap` terminou com sucesso, que a API esta `Running` e que `/api/me` retorna `200` para uma sessao autenticada ou `401` sem sessao, nunca `502`.
7. Verifique `https://baase.prymeiradigital.com.br/api/readiness`, crie uma area de teste, um processo com responsavel e um material de arquivo, e depois arquive a area usando o dialogo de impacto.

## Rollback

Se houver qualquer problema durante o soak, altere somente:

```env
BAASE_OPERATIONAL_STORE=jsonb
```

Atualize a stack. Nao apague as tabelas relacionais, o volume `prymeira_baase_postgres_data`, o volume `prymeira_baase_minio_data` ou `baase_records`. O legado continua intacto e o proximo corte pode ser refeito apos a correcao.

## Variaveis da Stack

O compose publica o alias DNS `minio` apenas na rede interna `prymeira_baase_internal`; o bucket nao recebe rota publica do Traefik. Para o MinIO, o operador fornece somente estas credenciais no ambiente da stack:

```env
BAASE_MINIO_ACCESS_KEY=troque_este_usuario
BAASE_MINIO_SECRET_KEY=troque_esta_senha_com_ao_menos_8_caracteres
```

Internamente, o compose fixa `S3_ENDPOINT=http://minio:9000`, `S3_REGION=us-east-1`, `S3_BUCKET=prymeira-baase`, `S3_FORCE_PATH_STYLE=true` e `S3_MULTIPART_CLEANUP_MODE=minio-native`. O servico MinIO recebe `MINIO_API_STALE_UPLOADS_EXPIRY=24h` e `MINIO_API_STALE_UPLOADS_CLEANUP_INTERVAL=1h`. O compose repassa `BAASE_MINIO_ACCESS_KEY` tanto para `MINIO_ROOT_USER` quanto para `S3_ACCESS_KEY`, e `BAASE_MINIO_SECRET_KEY` tanto para `MINIO_ROOT_PASSWORD` quanto para `S3_SECRET_KEY`.

Crie os volumes externos uma unica vez no node manager antes do deploy caso ainda nao existam:

```bash
docker volume create prymeira_baase_postgres_data
docker volume create prymeira_baase_minio_data
```

O volume `prymeira_baase_minio_data` contem os objetos persistidos. Nunca o apague durante deploy, rollback ou uma nova tentativa do bootstrap.

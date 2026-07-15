# Baase

## Evidências anexadas

Os anexos de evidência são enviados pelo adaptador S3 compatível já usado pela
API; em produção, o backend é o MinIO configurado para o Baase. Na stack oficial,
o operador define apenas estas credenciais do storage no ambiente (não registre
valores reais no repositório):

- `BAASE_MINIO_ACCESS_KEY`: usuário do MinIO.
- `BAASE_MINIO_SECRET_KEY`: senha do MinIO.

O compose mapeia essas credenciais internamente para `MINIO_ROOT_USER` e
`MINIO_ROOT_PASSWORD` no MinIO e para `S3_ACCESS_KEY` e `S3_SECRET_KEY` na API e
no bootstrap. Ele também fixa `S3_ENDPOINT=http://minio:9000`, região
`us-east-1`, bucket `prymeira-baase` e path-style habilitado; esses valores não
são inputs externos da stack.

No deploy de produção, o serviço one-shot `prymeira_baase_minio_bootstrap` executa
`storage:bootstrap`. O comando idempotente cria o bucket quando ele não existe,
preserva regras de lifecycle alheias, garante uma regra que aborta uploads multipart
incompletos sob `workspaces/` após um dia e termina somente depois de verificar o
contrato. A API tenta validar essa prontidão por até 30 tentativas durante a corrida
inicial com o bootstrap e permanece fail-closed se o storage não ficar pronto.

O Swarm inicia os serviços em paralelo; o compose não usa `depends_on` como falsa
garantia de ordenação. Nunca apague o volume externo
`prymeira_baase_minio_data` durante deploy, rollback ou nova tentativa de bootstrap.

A API aceita anexos de evidência de até **25 MB** por envio.

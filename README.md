# Baase

## Evidências anexadas

Os anexos de evidência são enviados pelo adaptador S3 compatível já usado pela
API; em produção, o backend é o MinIO configurado para o Baase. Configure os
seguintes valores no ambiente (não registre credenciais reais no repositório):

- `S3_ENDPOINT`: use `http://minio:9000` na rede interna da stack.
- `BAASE_MINIO_ACCESS_KEY` (repasse-o como `S3_ACCESS_KEY`): chave de acesso.
- `BAASE_MINIO_SECRET_KEY` (repasse-o como `S3_SECRET_KEY`): chave secreta.
- `S3_BUCKET`: bucket que armazena os anexos.

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

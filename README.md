# Baase

## Evidências anexadas

Os anexos de evidência são enviados pelo adaptador S3 compatível já usado pela
API; em produção, o backend é o MinIO configurado para o Baase. Configure os
seguintes valores no ambiente (não registre credenciais reais no repositório):

- `BAASE_MINIO_ENDPOINT` (repasse-o como `S3_ENDPOINT`): endpoint do serviço MinIO.
- `BAASE_MINIO_ACCESS_KEY` (repasse-o como `S3_ACCESS_KEY`): chave de acesso.
- `BAASE_MINIO_SECRET_KEY` (repasse-o como `S3_SECRET_KEY`): chave secreta.
- `S3_BUCKET`: bucket que armazena os anexos.

A API aceita anexos de evidência de até **25 MB** por envio.

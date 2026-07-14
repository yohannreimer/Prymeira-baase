# Baase

## Evidências anexadas

Os anexos de evidência são enviados pelo adaptador S3 compatível já usado pela
API; em produção, o backend é o MinIO configurado para o Baase. Configure os
seguintes valores no ambiente (não registre credenciais reais no repositório):

- `BAASE_MINIO_ENDPOINT` (repasse-o como `S3_ENDPOINT`): endpoint do serviço MinIO.
- `BAASE_MINIO_ACCESS_KEY` (repasse-o como `S3_ACCESS_KEY`): chave de acesso.
- `BAASE_MINIO_SECRET_KEY` (repasse-o como `S3_SECRET_KEY`): chave secreta.
- `S3_BUCKET`: bucket que armazena os anexos.

O bucket deve ter, antes da inicialização da API, uma regra de lifecycle habilitada
que cubra o prefixo `workspaces/` (ou o bucket inteiro) e aborte uploads multipart
incompletos em no máximo um dia. Exemplo de configuração compatível com S3/MinIO:

```json
{
  "Rules": [{
    "ID": "abort-incomplete-workspace-multipart",
    "Status": "Enabled",
    "Filter": { "Prefix": "workspaces/" },
    "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 }
  }]
}
```

A API apenas valida essa regra; ela nunca altera o lifecycle do bucket. Em modo S3,
a inicialização falha com `STUDIO_STORAGE_MULTIPART_LIFECYCLE_REQUIRED` quando a
regra está ausente, desabilitada, é mais lenta que um dia ou não pode ser consultada.

A API aceita anexos de evidência de até **25 MB** por envio.

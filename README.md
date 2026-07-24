# Baase

## Imagens e observabilidade em produção

A stack de produção exige `BAASE_IMAGE_TAG` com o SHA exato do commit publicado;
não existe fallback para `latest`. O mesmo SHA identifica as imagens web/API e
o release exibido no GlitchTip.

O operador pode definir DSNs separados em `BAASE_WEB_GLITCHTIP_DSN` e
`BAASE_API_GLITCHTIP_DSN`. Deixe ambos vazios para manter o monitoramento
desativado. `BAASE_GLITCHTIP_TRACES_SAMPLE_RATE` usa `0.01` por padrão e pode
ser alterado para `0` sem desligar a captura de erros. Tokens administrativos e
de source maps nunca pertencem ao ambiente do Portainer; consulte
`docs/glitchtip-rollout.md`.

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
e termina depois de verificar que ele está acessível. O MinIO remove uploads
multipart incompletos pelo mecanismo nativo do servidor: a stack fixa expiração em
24 horas e executa a varredura a cada hora. A API tenta validar a prontidão do
bucket por até 30 tentativas durante a corrida inicial com o bootstrap e permanece
fail-closed se o storage não ficar pronto. Em outros provedores S3, o modo padrão
continua exigindo uma regra de lifecycle compatível.

O Swarm inicia os serviços em paralelo; o compose não usa `depends_on` como falsa
garantia de ordenação. Nunca apague o volume externo
`prymeira_baase_minio_data` durante deploy, rollback ou nova tentativa de bootstrap.

A API aceita anexos de evidência de até **25 MB** por envio.

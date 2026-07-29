# Rollout do GlitchTip no Baase

Este rollout é incremental sobre um Baase já ativo em produção. A plataforma
central definida em `Prymeira-observability` precisa estar saudável, com
projetos e recuperação verificados, antes de qualquer atualização da
stack Baase.

## Pré-condições

- GlitchTip saudável por HTTPS;
- organização `Prymeira` com slug `prymeira-digital`;
- projetos `baase-web` e `baase-api`;
- webhook n8n → Evolution é opcional e pode ser configurado depois do rollout;
- backup recente da Droplet;
- pelo menos 5 GB livres;
- commit e imagens de rollback registrados.

## Baseline de produção

Baseline reconfirmada antes do rollout em `2026-07-29T20:06:31-03:00`:

| Sinal | Resultado |
| --- | --- |
| `/health` | HTTP 200, `ok` |
| `/api/health` | HTTP 200, serviço `baase-api` |
| `/api/readiness` | HTTP 200, produção, PostgreSQL, S3 e Studio prontos |

Estado observado no Portainer:

| Serviço | Réplicas |
| --- | --- |
| `baase_prymeira_baase_web` | `1/1` |
| `baase_prymeira_baase_api` | `1/1` |
| `baase_prymeira_baase_postgres` | `1/1` |
| `baase_prymeira_baase_minio` | `1/1` |
| `baase_prymeira_baase_minio_bootstrap` | `0/1` (job de bootstrap, sem tráfego) |

Digests de rollback registrados antes do rollout:

- `prymeira_baase_web`: `sha256:a290f14ee02e8b6c8053bd9000f23e488dad3835f479f32a25b9d77869ff8d81`;
- `prymeira_baase_api`: `sha256:52213626442fc0edabd7ea1f24704391322793d6912c65f6af1af33d0980b7bd`.

Não copie ambiente ou segredos do container.

## Projetos e DSNs

Use o DSN de `baase-web` somente em `BAASE_WEB_GLITCHTIP_DSN` no Portainer e o
DSN de `baase-api` somente em `BAASE_API_GLITCHTIP_DSN`. Ambos vazios
desabilitam toda a integração sem rollback de código.

O DSN do navegador é um identificador público de ingestão. Ele não substitui
token administrativo e não concede acesso ao painel. PostgreSQL, MinIO e o
bootstrap de storage não recebem DSN.

## Token de source maps

Crie no GlitchTip um token com o menor acesso disponível para releases e upload
de arquivos no projeto `prymeira-digital/baase-web`. Salve-o como secret do repositório
GitHub `GLITCHTIP_AUTH_TOKEN`. Não configure esse token no Portainer.

O build web envia source maps ocultos somente quando
`GLITCHTIP_SOURCEMAPS_UPLOAD=true`. O token é lido por um secret temporário do
BuildKit, nunca por `ARG` ou `ENV`; uma falha de token ou upload interrompe a
publicação da imagem. Depois do upload, os arquivos `.map` são removidos antes
da imagem nginx. Builds locais usam `false` e não precisam do token.

## Verificação antes da produção

Execute:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
docker stack config --compose-file docker-compose.prod.yml >/dev/null
```

Confirme build sem DSNs, filtro de privacidade, ausência de Replay/logs e
source maps ocultos.

## Publicação e rollout

1. Faça merge do commit revisado.
2. Aguarde as imagens web/API pelo SHA e o upload de source maps.
3. Registre SHA e digests.
4. No Portainer, informe o SHA completo em `BAASE_IMAGE_TAG` (a stack não aceita
   `latest`), os dois DSNs e
   `BAASE_GLITCHTIP_TRACES_SAMPLE_RATE=0.01`.
5. Reimplante e acompanhe tarefas/logs.
6. Verifique health, readiness, login e um fluxo normal do proprietário.

## Verificação sintética

- gere um evento API por comando dentro do container, sem criar endpoint HTTP;
- gere um erro controlado no navegador;
- confira release, stack TypeScript e ausência de dados pessoais;
- confirme que `4xx` esperados não criam incidentes;
- confirme que os incidentes permanecem armazenados no GlitchTip mesmo sem
  webhook configurado.

## Rollback

Na primeira regressão:

1. remova ambos os DSNs e reimplante o mesmo SHA;
2. se persistir, restaure o SHA/digest anterior;
3. preserve PostgreSQL e MinIO;
4. verifique health, readiness e login;
5. mantenha o GlitchTip isolado para diagnóstico.

## Observação de 24 horas

Registre no momento do rollout, em +1 hora e +24 horas:

- réplicas/restarts;
- health/readiness;
- fluxo representativo;
- latência;
- contagem de eventos/transações;
- CPU/RAM do GlitchTip e PostgreSQL;
- uso do disco raiz;
- ruído e volume dos incidentes.

Se o volume for excessivo, defina
`BAASE_GLITCHTIP_TRACES_SAMPLE_RATE=0`, mantendo captura de erros.

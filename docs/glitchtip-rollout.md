# Rollout do GlitchTip no Baase

Este rollout é incremental sobre um Baase já ativo em produção. A plataforma
central definida em `Prymeira-observability` precisa estar saudável, com
projetos, alertas e recuperação verificados, antes de qualquer atualização da
stack Baase.

## Pré-condições

- GlitchTip saudável por HTTPS;
- organização `Prymeira`;
- projetos `baase-web` e `baase-api`;
- workflow n8n → Evolution validado;
- backup recente da Droplet;
- pelo menos 5 GB livres;
- commit e imagens de rollback registrados.

## Baseline de produção

Verificação pública em `2026-07-24T14:27:55Z`:

| Sinal | Resultado |
| --- | --- |
| `/health` | HTTP 200, `ok` |
| `/api/health` | HTTP 200, serviço `baase-api` |
| `/api/readiness` | HTTP 200, produção, PostgreSQL, S3 e Studio prontos |

Os digests atuais de `prymeira_baase_web` e `prymeira_baase_api` serão
registrados por `docker service inspect` assim que o acesso autenticado ao
`manager01` estiver disponível. Não copie ambiente ou segredos do container.

## Projetos e DSNs

Use o DSN de `baase-web` somente em `BAASE_WEB_GLITCHTIP_DSN` no Portainer e o
DSN de `baase-api` somente em `BAASE_API_GLITCHTIP_DSN`. Ambos vazios
desabilitam toda a integração sem rollback de código.

O DSN do navegador é um identificador público de ingestão. Ele não substitui
token administrativo e não concede acesso ao painel.

## Token de source maps

Crie no GlitchTip um token com o menor acesso disponível para releases e upload
de arquivos no projeto `prymeira/baase-web`. Salve-o como secret do repositório
GitHub `GLITCHTIP_AUTH_TOKEN`. Não configure esse token no Portainer.

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
4. No Portainer, informe o mesmo SHA em `BAASE_IMAGE_TAG`, os dois DSNs e
   `BAASE_GLITCHTIP_TRACES_SAMPLE_RATE=0.01`.
5. Reimplante e acompanhe tarefas/logs.
6. Verifique health, readiness, login e um fluxo normal do proprietário.

## Verificação sintética

- gere um evento API por comando dentro do container, sem criar endpoint HTTP;
- gere um erro controlado no navegador;
- confira release, stack TypeScript e ausência de dados pessoais;
- confirme que `4xx` esperados não criam incidentes;
- confirme WhatsApp sem stack trace ou conteúdo do cliente.

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
- ruído e cooldown dos alertas.

Se o volume for excessivo, defina
`BAASE_GLITCHTIP_TRACES_SAMPLE_RATE=0`, mantendo captura de erros.

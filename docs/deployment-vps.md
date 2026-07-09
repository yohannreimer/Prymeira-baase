# Deploy VPS do Prymeira Baase

Este repo publica duas imagens no GHCR:

- `ghcr.io/yohannreimer/prymeira-baase-api:latest`
- `ghcr.io/yohannreimer/prymeira-baase-web:latest`

O arquivo `docker-compose.prod.yml` sobe uma stack Swarm com Postgres, API e Web para `https://baase.prymeiradigital.com.br`.

## Publicação das imagens

O workflow de GitHub Actions está versionado como template em `docs/github-workflows/publish-images.yml`.
Para ativar publicação automática no GHCR, copie esse arquivo para `.github/workflows/publish-images.yml` usando uma credencial GitHub com escopo `workflow`.

Enquanto isso, é possível publicar manualmente:

```bash
docker build -f apps/api/Dockerfile -t ghcr.io/yohannreimer/prymeira-baase-api:latest .
docker build -f apps/web/Dockerfile -t ghcr.io/yohannreimer/prymeira-baase-web:latest .
docker push ghcr.io/yohannreimer/prymeira-baase-api:latest
docker push ghcr.io/yohannreimer/prymeira-baase-web:latest
```

## Variáveis necessárias

Use `.env.production.example` como base no Portainer ou no terminal da VPS:

```env
BAASE_POSTGRES_PASSWORD=...
VITE_CLERK_PUBLISHABLE_KEY=...
OPENAI_API_KEY=...
DEEPGRAM_API_KEY=...
```

## Pré-requisitos na VPS

Crie o volume uma vez:

```bash
docker volume create prymeira_baase_postgres_data
```

A rede pública `network_swarm_public` já deve existir, como nos outros apps Prymeira.

## Deploy

```bash
docker stack deploy -c docker-compose.prod.yml prymeira_baase
```

## Ajuste necessário no Account Hub

Inclua `https://baase.prymeiradigital.com.br` no `CORS_ORIGINS` do serviço `prymeira_account_api`, porque o front do Baase chama:

```text
https://hub.prymeiradigital.com.br/api/access-check?product_key=base
```

Depois, garanta que o workspace de teste tenha entitlement ativo para o produto `base` no Account Hub.

# Baase Real Test Readiness Phase 4 Design

## Goal

Preparar o Prymeira Baase para testes internos reais, com ambiente local persistente, chaves de IA/transcricao claras e um endpoint de prontidao que mostre se o app esta rodando em modo demo, piloto ou incompleto.

## Scope

Fase 4 nao adiciona novas superficies de produto. Ela endurece a base para testar o produto que ja existe:

- Postgres ligado por `DATABASE_URL`.
- Seed/reset de workspace piloto para repetir testes.
- `.env.example` completo para API e web.
- Readiness endpoint informando persistencia, providers de IA e avisos.
- Documentacao de roteiro para rodar um teste verdadeiro local.

Fora desta fase:

- Clerk real.
- Upload/storage real.
- Deploy em cloud.
- E2E Playwright completo.

## Architecture

### Runtime config

Criar um modulo puro `apps/api/src/config/runtime.ts` que interpreta variaveis de ambiente e devolve:

- persistence: `postgres` ou `memory`;
- demoSeedEnabled;
- structured AI provider: `openai` ou `mock`;
- transcription provider: `deepgram` ou `mock`;
- warnings acionaveis para piloto.

Esse modulo tambem alimenta um endpoint `GET /readiness`.

### API readiness

`GET /health` continua simples para uptime.

`GET /readiness` mostra a qualidade operacional do ambiente:

```json
{
  "ok": false,
  "mode": "pilot",
  "persistence": "postgres",
  "ai": {
    "structured": "openai",
    "transcription": "deepgram"
  },
  "warnings": []
}
```

`ok` fica `true` quando o modo escolhido nao tem bloqueadores. Em `BAASE_RUNTIME_MODE=pilot`, faltar Postgres, OpenAI ou Deepgram gera warning e `ok: false`.

### Pilot workspace reset

Adicionar script `pnpm --filter @prymeira/baase-api db:reset:workspace` para limpar `baase_records` de um workspace. O default e `workspace_a`. Isso permite repetir onboarding/testes sem apagar o banco inteiro.

### Env/documentation

Completar `apps/api/.env.example` e criar `apps/web/.env.example` com as variaveis esperadas. Atualizar docs com um roteiro curto:

1. subir Postgres;
2. copiar envs;
3. inicializar schema;
4. rodar API/web;
5. checar `/readiness`;
6. testar onboarding com IA/audio.

## Testing

- Testes unitarios para `readRuntimeConfig`.
- Teste API para `GET /readiness`.
- Teste DB para reset por workspace.
- Verificacao completa com `pnpm test`, `pnpm typecheck`, `pnpm build`.


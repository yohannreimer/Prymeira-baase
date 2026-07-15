# Owner Studio — Rodadas de Testes

**Objetivo:** procurar regressões e incongruências em todas as 28 tarefas do plano `2026-07-13-owner-studio.md`, usando evidência automatizada, PostgreSQL real e navegação de ponta a ponta.

**Regra de defeito:** toda falha deve ser reproduzida, ter a causa rastreada até a origem e ganhar um teste de regressão antes da correção. Nenhum timeout será simplesmente aumentado para esconder instabilidade.

## Matriz de cobertura das tarefas

| Tarefa | Área validada | Evidência principal | Rodadas |
| --- | --- | --- | --- |
| 1 | Permissão explícita do dono | `roles.test.ts`, `access-policy.test.ts`, `App.studio-access.test.tsx` | 1, 5 |
| 2 | Tipos e payloads validados | `studio.schemas.test.ts`, typecheck compartilhado/API/web | 1, 6 |
| 3 | Fundação relacional | `operational-schema.test.ts`, PostgreSQL 16 | 2 |
| 4 | Repositórios em memória e PostgreSQL | `studio.repository.test.ts`, testes Postgres do Studio | 1, 2 |
| 5 | Documentos, versões, coleções e busca | `studio.service.test.ts`, `StudioLibrary.test.tsx`, `StudioSearch.test.tsx` | 1, 5 |
| 6 | Rotas privadas e wiring | `studio.routes.test.ts`, `app.test.ts`, isolamento E2E | 1, 5 |
| 7 | Assets privados e snapshots de links | testes `studio-asset*`, `studio-link-fetcher.test.ts`, S3 | 1, 3, 5 |
| 8 | Shell lazy exclusivo do dono | `App.studio-access.test.tsx`, E2E de papéis | 1, 5 |
| 9 | Mesa tranquila e captura universal | `StudioHome.test.tsx`, `UniversalCaptureComposer.test.tsx`, E2E de áudio | 1, 5 |
| 10 | Editor, autosave e versões | `StudioEditor.test.tsx`, `useStudioAutosave.test.tsx`, stress concorrente | 1, 3, 5 |
| 11 | Inbox, coleções, arquivo e busca lexical | `StudioLibrary.test.tsx`, `StudioCollections.test.tsx`, `StudioSearch.test.tsx` | 1, 5 |
| 12 | Streaming, embeddings e pesquisa consentida | `ai-harness.test.ts`, `ai-providers.test.ts`, E2E de pesquisa | 1, 3, 5 |
| 13 | Prompts e schemas de sugestões | `ai-registries.test.ts`, `ai-harness.test.ts` | 1 |
| 14 | Memória semântica privada | `studio-memory.test.ts`, PostgreSQL lexical/vetorial guardado | 1, 2, 3 |
| 15 | Contexto operacional allowlisted e citações | `studio-context-builder.test.ts`, `StudioCitations.test.tsx`, E2E | 1, 5 |
| 16 | Conversas, SSE e decisões de sugestões | testes `studio-assistant*`, `StudioCopilot.test.tsx` | 1, 3, 5 |
| 17 | Copiloto, fontes e pensamentos relacionados | `StudioCopilot.test.tsx`, `RelatedThoughts.test.tsx`, E2E | 1, 5 |
| 18 | Metas, decisões, planos e rituais persistidos | `studio-structures.test.ts`, repositório e PostgreSQL | 1, 2, 5 |
| 19 | Estrutura estratégica progressiva | `StudioStructures.test.tsx` | 1, 5 |
| 20 | Sessões e preparação determinística de rituais | `studio-ritual.service.test.ts`, rotas e runner | 1, 3, 5 |
| 21 | Interface privada de rituais | `StudioRituals.test.tsx`, E2E de ritual | 1, 5 |
| 22 | Prévia operacional idempotente | testes `studio-operations-bridge*`, upgrade PostgreSQL | 1, 2, 3, 5 |
| 23 | Interface de revisão antes de criar | `OperationPreview.test.tsx`, E2E de resposta perdida | 1, 3, 5 |
| 24 | Preparação agendada e proatividade configurável | testes `studio-proactivity*`, maintenance runner | 1, 3, 5 |
| 25 | Exportação, exclusão e perda de papel | testes `studio-portability*`, `StudioPrivacySettings.test.tsx`, E2E de papéis | 1, 2, 3, 5 |
| 26 | Observabilidade segura e regressões de segurança | `studio-security.test.ts`, telemetry e ataques de payload | 1, 3 |
| 27 | Acessibilidade, responsividade e performance | `studio-accessibility.test.tsx`, build e E2E responsivo | 4, 5, 6 |
| 28 | Aceitação E2E, documentação e release gate | `owner-studio.spec.ts`, `owner-studio-responsive.spec.ts`, gate completo | 5, 6 |

## Rodada 0 — Integridade do snapshot

- Confirmar branch, HEAD, árvore limpa e sincronização com `origin/main`.
- Confirmar versões de Node, pnpm, Chromium e PostgreSQL.
- Verificar que as 26 migrações do Studio continuam presentes e imutáveis.

## Rodada 1 — Contratos, domínio e componentes

Executar a suíte completa e também as trilhas focadas para facilitar a localização de falhas:

```bash
pnpm test
pnpm --filter @prymeira/baase-api exec vitest run src/modules/studio src/modules/ai
pnpm --filter @prymeira/baase-web exec vitest run src/studio src/App.studio-access.test.tsx
```

Critérios: zero falhas; skips PostgreSQL somente quando a variável do banco não estiver configurada; nenhuma atualização de snapshot implícita.

## Rodada 2 — PostgreSQL 16 e migrações

```bash
TEST_DATABASE_URL=postgresql://yohannreimer@127.0.0.1:55432/postgres \
  pnpm --filter @prymeira/baase-api test:postgres-schema
```

Validar criação limpa, upgrade aditivo, constraints de isolamento, índices, idempotência e concorrência. `pgvector` pode ser ignorado apenas se o teste registrar explicitamente `STUDIO_MEMORY_VECTOR_PREREQUISITE_UNAVAILABLE`; a busca lexical deve continuar validada.

## Rodada 3 — Resiliência, concorrência e falhas

- Repetir autosave, upload multipart, exportação e confirmação operacional sob concorrência.
- Exercitar resposta perdida, duplo clique, revisão obsoleta, lease vencido, timeout e provedor de IA indisponível.
- Rodar os testes historicamente sensíveis várias vezes e, depois, em processos concorrentes.

```bash
for i in {1..10}; do
  pnpm --filter @prymeira/baase-web exec vitest run \
    src/studio/useStudioAutosave.test.tsx src/studio/StudioEditor.test.tsx || exit 1
done

for i in {1..10}; do
  pnpm --filter @prymeira/baase-api exec vitest run \
    src/modules/studio/studio-assets.routes.test.ts \
    src/modules/studio/studio-operations-bridge.test.ts \
    src/modules/studio/studio-portability.service.test.ts || exit 1
done
```

## Rodada 4 — Acessibilidade, build e orçamento visual

```bash
pnpm typecheck
pnpm build
pnpm --filter @prymeira/baase-web exec vitest run src/studio/studio-accessibility.test.tsx
```

Revisar warnings de bundle separadamente: warning não é falha, mas crescimento inesperado em relação à evidência da Tarefa 27 deve abrir defeito.

## Rodada 5 — Navegador e papéis reais

```bash
pnpm exec playwright test \
  tests/e2e/owner-studio.spec.ts \
  tests/e2e/owner-studio-responsive.spec.ts \
  --project=chromium
```

Além dos 13 cenários automatizados, inspecionar console, erros de página, requests 4xx/5xx inesperados, foco, rolagem horizontal e sobreposição nos viewports 1440×1000, 1024×900, 768×900 e 390×844.

Papéis obrigatórios: dono atual, outro dono, gestor e funcionário. O Estúdio não pode aparecer nem ser descoberto por URL para os três escopos não autorizados.

## Rodada 6 — Gate final

Repetir, no HEAD final e depois de qualquer correção:

```bash
pnpm test
pnpm typecheck
pnpm build
TEST_DATABASE_URL=postgresql://yohannreimer@127.0.0.1:55432/postgres \
  pnpm --filter @prymeira/baase-api test:postgres-schema
pnpm test:e2e
git diff --check
git status --short
```

## Registro de execução

| Rodada | Estado | Evidência / defeitos |
| --- | --- | --- |
| 0 — snapshot | Aprovada | `main` partiu de `ad4034d`, sincronizada com `origin/main`; Node 25.6.0, pnpm 9.15.4, Playwright 1.61.1, Chromium 1228 e PostgreSQL 16.14. As 26 migrações foram enumeradas. A cópia principal precisava apenas sincronizar os pacotes já presentes no lockfile com `pnpm install --frozen-lockfile`. |
| 1 — domínio/componentes | Aprovada após correção | Suíte completa: shared 17, API 844/122 skips condicionais, web 288. Foco Studio/IA: API 377/35 skips e web 180. Sob carga, dois testes de deadline multipart usavam 15 ms reais antes de alcançar a fase observada; reproduções pré-fix falharam 7/8 (`begin`) e 8/8 (`attach`). Depois de barreiras de fase e fake timers: 8/8 processos e arquivo completo 5/5. Runtime inalterado. |
| 2 — PostgreSQL | Aprovada após correção | Quatro suítes reais: 80 aprovados e 1 skip explícito de `pgvector`. Foram corrigidas expectativas obsoletas: tarefa concluída agora permanece como histórico; falha na reconciliação atômica faz rollback total; ocorrências pendentes acompanham nova revisão enquanto submetidas continuam históricas. |
| 3 — resiliência | Aprovada | Editor/autosave 10/10 rodadas; assets/operações/portabilidade 10/10 rodadas; cenários multipart concorrentes 8/8; resposta perdida e confirmação idempotente cobertas também no E2E. |
| 4 — acessibilidade/build | Aprovada | Typecheck e build concluíram; acessibilidade 7/7. JS inicial permaneceu em 570,60 kB / 160,25 kB gzip. O crescimento lazy do Estúdio para 567,43 kB / 175,08 kB gzip é explicado pela prévia operacional e demais recursos posteriores ao baseline `c8057a3`; nenhuma importação vazou para a rota inicial. |
| 5 — navegador/papéis | Aprovada | E2E normal 13/13 e repetição 26/26. Capturas 1440/1024/768/390 inspecionadas sem overflow, cortes ou sobreposição; sidecar/sheet, foco, scroll, dono/outro dono/gestor/funcionário passaram. |
| 6 — gate final | Aprovada | No snapshot final: shared 17, API 844/122 skips condicionais, web 288; typecheck e build aprovados; PostgreSQL real 80/1 skip explícito; E2E 13/13; `git diff --check` sem erros. |

## Defeitos encontrados e tratados

1. **Ordem de deadline multipart nos testes:** o deadline real podia encerrar a resposta antes de o teste entrar em `beginAtomicUpload` ou `attachAssetUploadSession`. A produção já desacoplava corretamente resposta e settlement. Os testes agora controlam relógio e fase, sem ampliar timeouts.
2. **Histórico concluído em PostgreSQL:** uma expectativa anterior tentava apagar uma tarefa concluída, contrariando a regra atual de preservação. O teste agora exige `TASK_NOT_PENDING` e confirma checklist/evidência intactos.
3. **Injeção de falha anterior à reconciliação atômica:** o teste sobrescrevia um método que não participa mais da geração. A falha agora é injetada dentro da transação, após inserções de tarefas e antes do agregado, comprovando rollback total.
4. **Revisões pendentes:** uma expectativa antiga congelava tarefas ainda pendentes. O teste agora comprova o contrato vigente: mantém o ID compatível, atualiza conteúdo/revisão e remove o passo excluído; somente tarefas submetidas preservam a versão histórica.

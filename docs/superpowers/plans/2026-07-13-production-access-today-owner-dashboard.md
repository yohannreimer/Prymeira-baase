# Production Access, Today, and Owner Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir escopos de produção, nome da empresa, checklist inline e duplicação do Painel do Dono.

**Architecture:** Aplicar invariantes de alcance no domínio de pessoas e uma migração idempotente para dados legados. Reutilizar a rota existente de atualização de checklist no Hoje e compor o acompanhamento operacional dentro de um único cabeçalho do Painel do Dono.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, React 19, Vitest e CSS.

---

### Task 1: Escopo seguro por papel

**Files:**
- Modify: `apps/api/src/modules/company/company.types.ts`
- Modify: `apps/api/src/modules/company/company.service.test.ts`
- Modify: `apps/api/src/modules/company/access-policy.test.ts`

- [ ] Escrever testes que exijam `workspace` para dono, `area` para gestor e `assigned_only` para funcionário, mesmo quando o valor persistido ou enviado for `workspace`.
- [ ] Rodar os testes e confirmar a falha com a normalização atual.
- [ ] Alterar `normalizeAccessScope` para impor as três invariantes.
- [ ] Rodar os testes focados e confirmar aprovação.

### Task 2: Migração dos registros existentes

**Files:**
- Modify: `apps/api/src/db/operational-schema.ts`
- Modify: `apps/api/src/db/operational-schema.test.ts`
- Modify: `apps/api/src/db/operational-schema.postgres.test.ts`

- [ ] Criar teste para a versão 8 com atualização de gestores para `area` e funcionários para `assigned_only`.
- [ ] Rodar o teste e confirmar que a migração ainda não existe.
- [ ] Adicionar migração `role_safe_access_scopes`, preservando donos como `workspace` e preenchendo `person_area_access` para gestores.
- [ ] Rodar testes de schema em memória e PostgreSQL quando a variável de teste estiver disponível.

### Task 3: Nome real da empresa

**Files:**
- Modify: `apps/api/src/modules/session/session.routes.ts`
- Modify: `apps/api/src/app.test.ts`

- [ ] Escrever teste de conta autenticada com nome externo pessoal e `onboardingSession.companyName` empresarial.
- [ ] Confirmar que o teste falha retornando o nome pessoal.
- [ ] Priorizar `onboardingSession.companyName`, usando o nome externo apenas como fallback.
- [ ] Rodar o teste focado.

### Task 4: Checklist inline

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] Escrever teste que expande uma ocorrência, clica no primeiro checkbox, chama `PATCH /api/tasks/:id/checklist` e exibe `1/9` sem `Abrir checklist`.
- [ ] Confirmar falha no comportamento atual.
- [ ] Passar o callback de atualização para `TodayPage`, renderizar inputs acessíveis e remover o botão antigo.
- [ ] Preservar uma ação `Concluir tarefa` ou `Enviar evidência` somente quando a execução final exigir o modal existente.
- [ ] Reverter o item em falha e exibir aviso.
- [ ] Rodar testes e typecheck do web.

### Task 5: Painel do Dono único

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] Escrever teste que exija uma única saudação, uma única grade de métricas e ausência do heading concorrente `Acompanhamento operacional`.
- [ ] Confirmar falha no layout atual.
- [ ] Incorporar saudação/ação ao painel operacional, remover o resumo duplicado de `OwnerDashboard` e manter apenas seções complementares.
- [ ] Remover `ActivationPlanPanel` e sua renderização.
- [ ] Ajustar ritmo e responsividade sem criar cartões aninhados.
- [ ] Rodar testes e build do web.

### Task 6: Verificação e publicação

**Files:**
- Modify only if verification reveals a defect.

- [ ] Rodar `git diff --check`.
- [ ] Rodar `pnpm test`.
- [ ] Rodar `pnpm typecheck`.
- [ ] Rodar `pnpm build`.
- [ ] Revisar o diff contra todos os requisitos da especificação.
- [ ] Commitar as alterações e enviar `main` para `origin`.

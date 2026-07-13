# Operational Consistency Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar dados de demonstração da operação real, aplicar acesso por papel no servidor e tornar Hoje, treinamentos, comunicados, painéis e navegação coerentes com as especificações aprovadas.

**Architecture:** A API será a autoridade de visibilidade e mutação, com políticas focadas por recurso e respostas já filtradas. O frontend derivará calendário e indicadores dos dados reais, renderizará ações por capacidade e manterá navegação serializável na URL. Componentes cenográficos serão removidos ou substituídos por estados vazios honestos.

**Tech Stack:** Fastify 5, TypeScript, Zod, PostgreSQL, React 19, Vite, Vitest e Testing Library.

---

### Task 1: Calendário operacional real

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/api.ts`
- Test: `apps/web/src/App.test.tsx`

- [x] Escrever testes com relógio controlado provando que Hoje, período padrão e nova tarefa usam a data local atual.
- [x] Executar o teste focal e confirmar falha pela constante `2026-07-07`.
- [x] Criar helpers de data em `America/Sao_Paulo`, remover textos e defaults fixos e carregar o bundle com a data derivada.
- [x] Executar novamente os testes focais.

### Task 2: Política de leitura mínima para empresa e conhecimento

**Files:**
- Modify: `apps/api/src/modules/company/company.routes.ts`
- Modify: `apps/api/src/modules/company/access-policy.ts`
- Modify: `apps/api/src/modules/processes/process.routes.ts`
- Modify: `apps/web/src/api.ts`
- Test: `apps/api/src/modules/company/company.routes.test.ts`
- Test: `apps/api/src/modules/processes/process.routes.test.ts`

- [x] Escrever testes provando que funcionário não lista pessoas/convites e que `assigned_only` recebe somente processo publicado referenciado por sua tarefa.
- [x] Escrever testes provando que gestor não publica, altera ou exclui processo fora de suas áreas.
- [x] Introduzir políticas de leitura/gestão por recurso e aplicá-las antes de listar ou mutar.
- [x] Fazer o bootstrap omitir endpoints administrativos para funcionário.
- [x] Executar suites de empresa, processos e bootstrap web.

### Task 3: Treinamentos com audiência e conclusão verdadeiras

**Files:**
- Modify: `apps/api/src/modules/trainings/training.routes.ts`
- Modify: `apps/api/src/modules/trainings/training.service.ts`
- Modify: `apps/api/src/modules/dashboard/dashboard.service.ts`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/api/src/modules/trainings/training.routes.test.ts`
- Test: `apps/api/src/modules/trainings/training.service.test.ts`
- Test: `apps/web/src/App.test.tsx`

- [x] Escrever testes para audiência por pessoa/cargo/área, publicado somente e mutação gerencial restrita à área.
- [x] Escrever teste impedindo tentativa sem atribuição e definindo conclusão explícita para treinamento sem quiz.
- [x] Centralizar correspondência de audiência e validar acesso em listar, mutar, atribuir e responder.
- [x] Filtrar contagem pendente por escopo do painel.
- [x] Renderizar somente ações permitidas e oferecer conclusão válida sem quiz.
- [x] Executar suites de treinamento e painel.

### Task 4: Comunicados com quiz real

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/api/src/modules/announcements/announcement.routes.ts`
- Test: `apps/web/src/App.test.tsx`
- Test: `apps/api/src/modules/announcements/announcement.routes.test.ts`

- [x] Escrever teste que exige resposta visível de todas as perguntas e não envia a alternativa correta automaticamente.
- [x] Renderizar perguntas e opções, bloquear confirmação incompleta e exibir retorno de erro.
- [x] Ocultar criação/exclusão para funcionário e validar mutações no servidor.
- [x] Executar testes focais.

### Task 5: Execução pessoal e checklist consistente

**Files:**
- Modify: `apps/api/src/modules/company/access-policy.ts`
- Modify: `apps/api/src/modules/routines/routine.routes.ts`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/api/src/modules/routines/routine.routes.test.ts`
- Test: `apps/web/src/App.test.tsx`

- [x] Escrever testes provando que nem dono executa ocorrência atribuída a outra pessoa e que checklist pontual exibe/salva `0/N` inline.
- [x] Remover override de execução por dono e manter visão global exclusivamente nos painéis.
- [x] Separar detalhe de definição de rotina da execução, removendo checkboxes locais não persistentes.
- [x] Garantir erro visível e reversão quando checklist falhar.
- [x] Executar suites de rotina e Hoje.

### Task 6: Painéis somente com métricas reais

**Files:**
- Modify: `apps/api/src/modules/dashboard/dashboard.service.ts`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/api/src/modules/dashboard/dashboard.routes.test.ts`
- Test: `apps/web/src/App.test.tsx`

- [x] Escrever testes para equipe do gestor restrita à área, progresso por pessoa e treinamentos pendentes escopados.
- [x] Remover prioridade inventada, `0/0` fixo e `routines.slice(0, 3)` como criticidade.
- [x] Calcular ou ocultar sinais sem fonte de dados; usar estados vazios honestos.
- [x] Corrigir rótulos de métricas para não misturar treinamento e processo.
- [x] Executar suites de painel.

### Task 7: Navegação, busca, ações e erros coerentes por papel

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/App.test.tsx`

- [x] Escrever testes para busca funcional, bloqueio de telas administrativas e restauração de tela/período/pessoa pela URL.
- [x] Derivar permissões de navegação e de ações do papel autenticado.
- [x] Implementar busca real nos recursos visíveis, sincronizar rota/filtros com URL e voltar preservando contexto.
- [x] Tornar falhas de mutação visíveis e acessíveis.
- [x] Adicionar navegação inferior móvel para funcionário e remover shells permanentemente vazios.
- [x] Executar suite web.

### Task 8: Verificação integral e limpeza de protótipo

**Files:**
- Modify: arquivos tocados nas tarefas anteriores
- Test: todas as suites

- [x] Buscar datas fixas, métricas falsas, fallbacks de produção e ações sem capacidade; remover ocorrências restantes.
- [x] Executar `pnpm test`, `pnpm typecheck` e `pnpm build`.
- [x] Executar inspeção manual local nos papéis dono, gestor e funcionário, incluindo mobile.
- [x] Revisar o diff final contra cada item da auditoria e registrar qualquer limitação real, sem mascará-la com placeholder.

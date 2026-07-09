# Baase Trainings And Announcements Phase 6/7 Design

Atualizado em: 2026-07-07

## Objetivo

Transformar Treinamentos Leves e Comunicados em fluxos funcionais para teste real na VPS. O dono deve criar/publicar conteúdo, atribuir para a equipe, o funcionário deve ver pendências no Hoje e concluir ações, e o gestor/dono deve conseguir enxergar o estado operacional básico.

## Escopo

### Fase 6 — Treinamentos Leves

- Manter o CRUD atual de treinamentos com aula curta, PDF/link e quiz.
- Adicionar atribuição de treinamento para `all`, `area`, `role` ou `person`.
- Adicionar prazo opcional.
- Expor pendências por funcionário.
- Concluir treinamento via tentativa de quiz.
- Calcular status por funcionário: `pending`, `completed` ou `overdue`.

### Fase 7 — Comunicados E Confirmações

- Criar comunicados do tipo `simple`, `process_change` ou `mandatory_training`.
- Definir público por `all`, `area`, `role` ou `person`.
- Definir exigência: `none`, `read_confirmation` ou `quiz_confirmation`.
- Publicar/despublicar comunicado.
- Funcionário confirma leitura e, quando houver quiz, responde a pergunta.
- Expor pendências de comunicados no Hoje.

## Fora Do Escopo Agora

- Upload/storage real de PDF/foto.
- Notificações por email/WhatsApp.
- Certificados, trilhas, recorrência de treinamento.
- Métricas complexas por pessoa/equipe.
- Integração final Clerk/Account API além dos headers locais atuais.

## Arquitetura

O backend continua usando módulos pequenos por domínio. Treinamentos ganham `TrainingAssignment` e listagem de progresso calculado a partir de `QuizAttempt`. Comunicados entram como módulo próprio com `Announcement` e `AnnouncementReceipt`.

O endpoint `GET /today` continua sendo a entrada principal do funcionário, mas passa a devolver também:

- `training_assignments`: treinamentos pendentes/concluídos do perfil atual;
- `announcements`: comunicados publicados que exigem ação do perfil atual.

O frontend mantém o layout atual. As telas de Treinamentos e Comunicados deixam de ser apenas mock/local state e passam a chamar a API. O formulário de treinamento ganha público/prazo. A tela de comunicados ganha criação/publicação e confirmação.

## Regras De Produto

- IA e dono criam rascunhos; funcionário só vê conteúdo publicado.
- Treinamento publicado não fica automaticamente concluído para ninguém.
- Se houver quiz, a conclusão depende de tentativa com aprovação mínima.
- Comunicado com `none` pode ser apenas informativo.
- Comunicado com `read_confirmation` exige confirmação.
- Comunicado com `quiz_confirmation` exige resposta correta.
- Nenhum fluxo apaga histórico de tentativa ou recibo.

## Critério De Pronto

- Onboarding pode criar treinamentos como hoje.
- Dono pode criar treinamento, publicar e atribuir.
- Funcionário vê treinamento pendente no Hoje e na tela Treinamentos.
- Funcionário responde quiz e o status deixa de ficar pendente.
- Dono pode criar comunicado, publicar e vê-lo no histórico.
- Funcionário vê comunicado pendente no Hoje e consegue confirmar.
- Dados persistem em Postgres via `baase_records`.
- `pnpm test`, `pnpm typecheck` e `pnpm build` passam.

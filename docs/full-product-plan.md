# Prymeira Baase — Plano do Produto Completo

> Plano mestre para construir o Prymeira Baase como produto completo, mantendo a visão integral discutida: IA operacional, onboarding mágico, portal interno completo, rotinas, processos, treinamentos, comunicados e execução diária.

Atualizado em: 2026-07-07

---

## 1. Decisão central

O Baase não será tratado como um MVP pequeno de checklist.

O produto final a construir é:

> **A base operacional com IA para donos tirarem a empresa da cabeça e colocarem a equipe para executar do jeito certo.**

Na prática, a implementação pode ser faseada por engenharia, mas cada fase deve caminhar para o produto completo. Não cortar a visão para virar apenas "tarefas", "SOPs" ou "diagnóstico".

---

## 2. Produto completo

### Superfícies obrigatórias

1. Landing premium própria.
2. Login/auth integrado ao Hub/Clerk.
3. Onboarding inteligente por segmento com áudio/texto.
4. Revisão da empresa sugerida pela IA.
5. Painel do Dono.
6. Painel do Gestor.
7. Hoje do Funcionário.
8. Mapa da Empresa.
9. Equipe e convites.
10. Processos/SOPs com versões.
11. Rotinas recorrentes.
12. Checklists.
13. Evidências com foto/comentário.
14. Aprovações.
15. Treinamentos leves com materiais e quiz.
16. Comunicados com confirmação e quiz.
17. Comentários contextuais.
18. Biblioteca de Modelos.
19. Criar com IA.
20. Experiência mobile excelente.

### Product key sugerido

```txt
base
```

Nome comercial:

```txt
Prymeira Baase
```

---

## 3. Arquitetura de produto

### Regra estrutural

O Baase tem uma única base operacional, mas a experiência muda por papel.

- Dono entra no Painel do Dono.
- Gestor entra no Painel da Área.
- Funcionário entra no Hoje.

### Papéis V1

- Dono.
- Gestor.
- Funcionário.

### Modelo organizacional

- Workspace = empresa.
- Empresa tem áreas.
- Área tem cargos.
- Pessoas pertencem a área/cargo.
- Rotinas podem ser atribuídas à empresa, área, cargo ou pessoa.
- Pessoas herdam rotinas de área/cargo e podem ter exceções individuais.

### Conteúdo vs execução

Conteúdo de conhecimento:

- processos;
- treinamentos;
- comunicados;
- modelos.

Execução operacional:

- rotinas;
- checklists;
- tarefas do dia;
- evidências;
- aprovações.

---

## 4. Fases de construção

As fases abaixo não representam um produto reduzido. Elas representam a ordem segura para construir o produto completo.

### Fase 1 — Fundação Baase

Objetivo: criar o app, registrar o produto no ecossistema e estabelecer a base multi-workspace.

Entregas:

- app web Baase;
- `product_key=base`;
- login branded Quiet Ops;
- access-check com Account API;
- workspace isolado;
- papéis Dono/Gestor/Funcionário;
- shell responsivo;
- rotas principais vazias;
- seed/demo local.

Critério de pronto:

- dono acessa o Baase pelo Hub;
- funcionário convidado acessa somente o Baase;
- app diferencia home por papel;
- dados ficam isolados por workspace.

### Fase 2 — Mapa da Empresa e Equipe

Objetivo: permitir que o dono represente a empresa real.

Entregas:

- áreas;
- cargos;
- pessoas;
- convites por link/código;
- aceite de convite;
- perfil operacional do funcionário;
- acesso a processos por padrão completo ou limitado por área/cargo.

Critério de pronto:

- dono consegue criar áreas/cargos;
- dono convida funcionário;
- funcionário cria conta, entra e vê sua home;
- gestor vê painel da área.

### Fase 3 — Onboarding Inteligente

Objetivo: entregar o primeiro momento wow.

Entregas:

- escolha rápida de segmento;
- perguntas abertas;
- resposta por texto;
- resposta por áudio com transcrição;
- IA gera sugestões de áreas, cargos, rotinas, processos, treinamentos e lacunas;
- tela de revisão da empresa sugerida;
- ações: aceitar, editar, ignorar, criar com IA.

Critério de pronto:

- dono escolhe segmento;
- responde sobre a empresa;
- recebe estrutura inicial sugerida;
- nada é publicado automaticamente sem revisão.

### Fase 4 — Processos/SOPs com Versões

Objetivo: criar o manual vivo da empresa.

Entregas:

- CRUD de processos;
- status rascunho/publicado/arquivado;
- etapas;
- anexos/materiais;
- scripts/exemplos;
- áreas/cargos/pessoas relacionadas;
- responsável opcional;
- histórico de versões;
- nota de mudança;
- comunicar mudança para equipe.

Critério de pronto:

- processo publicado pode ser consultado pela equipe;
- edição de processo publicado cria nova versão;
- mudança pode gerar comunicado.

### Fase 5 — Rotinas, Checklists e Execução Diária

Objetivo: transformar a base em operação diária.

Entregas:

- rotinas recorrentes;
- checklists;
- atribuição por empresa/área/cargo/pessoa;
- geração diária de tarefas;
- tela Hoje do funcionário;
- estados de tarefa;
- evidência por foto/comentário;
- aprovação opcional;
- pedido de ajuste.

Critério de pronto:

- funcionário abre o Hoje e sabe o que fazer;
- rotina por cargo aparece para todos daquele cargo;
- gestor/dono acompanha atrasos e aprovações.

### Fase 6 — Treinamentos Leves

Objetivo: garantir que a equipe aprenda os processos.

Status em 2026-07-07: implementação operacional base concluída para teste interno. Já existe CRUD de treinamentos, publicação, atribuição, quiz, progresso por funcionário e pendência no Hoje.

Entregas:

- treinamentos com rascunho/publicado/arquivado;
- material em PDF/anexo/link;
- conteúdo curto;
- quiz simples;
- atribuição para todos/área/cargo/pessoa;
- status por funcionário;
- gerar treinamento com IA a partir de processo ou material.

Critério de pronto:

- funcionário faz treinamento no portal;
- dono vê pendências;
- processo pode virar treinamento com quiz.

### Fase 7 — Comunicados e Confirmações

Objetivo: substituir recados soltos por comunicação operacional rastreável.

Status em 2026-07-07: implementação operacional base concluída para teste interno. Já existe criação, publicação, listagem por público, confirmação, confirmação com quiz, recibos e pendência no Hoje.

Entregas:

- aviso simples;
- mudança de processo;
- treinamento obrigatório;
- público por todos/área/cargo/pessoa;
- confirmação de leitura;
- confirmação + quiz;
- histórico de comunicados;
- pendências no Hoje.

Critério de pronto:

- dono comunica mudança;
- funcionário confirma leitura;
- dono vê quem leu e quem não leu.

### Fase 8 — Comentários Contextuais

Objetivo: permitir conversa sem virar chat bagunçado.

Entregas:

- comentários em tarefa/checklist;
- comentários em processo;
- comentários em aprovação;
- escalação de dúvida para gestor;
- menção simples;
- histórico ligado ao objeto.

Critério de pronto:

- conversa sempre nasce de tarefa, processo, aprovação ou dúvida;
- não existe chat geral no V1.

### Fase 9 — Biblioteca de Modelos

Objetivo: acelerar a adoção e dar sensação de produto completo.

Entregas:

- biblioteca explorável;
- filtros por área, segmento, tipo e nível;
- modelos essenciais;
- usar modelo;
- adaptar modelo com IA;
- criar rascunho ou rotina ativa a partir de modelo.

Critério de pronto:

- dono consegue começar por modelos prontos;
- modelos cobrem atendimento, vendas, financeiro, operação, equipe e gestão.

### Fase 10 — IA Operacional Completa

Objetivo: consolidar a IA como camada transformadora do produto.

Entregas sob demanda:

- criar processo;
- criar rotina;
- gerar checklist;
- gerar treinamento;
- melhorar processo;
- transformar áudio em SOP;
- transformar PDF em treinamento;
- resumir comentários;
- criar comunicado;
- sugerir quiz.

Entregas proativas em pontos-chave:

- rotina atrasou várias vezes;
- processo gerou muitas dúvidas;
- processo foi alterado;
- treinamento teve muitas reprovações;
- rotina crítica sem aprovação;
- cargo sem treinamento;
- área criada sem rotina.

Critério de pronto:

- IA nunca publica conteúdo sozinha;
- IA só interrompe com motivo operacional concreto;
- dono sempre aprova antes de afetar equipe.

### Fase 11 — Painel do Dono e Painel do Gestor

Objetivo: dar controle sem BI pesado.

Painel do Dono:

- execuções de hoje;
- atrasos;
- treinamentos pendentes;
- processos incompletos;
- aguardando aprovação;
- rotinas críticas;
- equipe;
- sugestões de melhoria.

Painel do Gestor:

- tarefas da área;
- atrasos da equipe;
- aprovações pendentes;
- treinamentos pendentes;
- dúvidas e comentários da área.

Critério de pronto:

- dono entende o que precisa de atenção;
- gestor acompanha sua área sem ver complexidade desnecessária.

### Fase 12 — Landing Premium e Ativação Comercial

Objetivo: vender o Baase como produto premium de entrada.

Entregas:

- landing própria;
- hero com produto visível;
- narrativa da dor do dono;
- explicação do onboarding com IA;
- demonstração do áudio virando processo;
- seção portal da equipe;
- seção modelos;
- seção ecossistema Prymeira;
- CTA para começar.

Critério de pronto:

- visitante entende o produto sem conhecer o Hub;
- landing transmite produto premium, calmo e inovador;
- CTA leva para signup/checkout do Baase.

---

## 5. Ordem recomendada para design de telas

1. Landing premium.
2. Login branded.
3. Onboarding por segmento.
4. Captura por áudio/texto.
5. Revisão da empresa sugerida.
6. Painel do Dono.
7. Hoje do Funcionário.
8. Processo/SOP.
9. Rotina/checklist.
10. Treinamento.
11. Comunicado.
12. Biblioteca de Modelos.
13. Equipe e convites.
14. Painel do Gestor.

---

## 6. Ordem recomendada para implementação

1. Criar app e auth.
2. Criar modelo de workspace/papéis/perfis operacionais.
3. Criar áreas/cargos/pessoas/convites.
4. Criar processos com versões.
5. Criar rotinas/checklists/tarefas.
6. Criar Hoje do Funcionário.
7. Criar aprovações/evidências.
8. Criar treinamentos.
9. Criar comunicados.
10. Criar comentários contextuais.
11. Criar biblioteca de modelos.
12. Criar onboarding IA.
13. Criar Criar com IA.
14. Criar IA proativa em pontos-chave.
15. Criar painel completo.
16. Criar landing premium.
17. Polir mobile/desktop.

Observação: a landing pode ser feita antes para validação comercial, mas o app precisa ser planejado como produto completo desde o início.

---

## 7. Decisões ainda abertas

### Comercial

- Baase será produto solo?
- Baase entra nos pacotes atuais?
- Suite Completa inclui Baase?
- Qual será o preço fundador?
- Limites por plano: usuários, processos, rotinas, treinamentos, IA?

### Técnica

- Baase será monorepo próprio ou app dentro do Hub?
- Banco próprio ou schema próprio no Account/Hub?
- Upload de foto/material: R2, S3 ou storage existente?
- Transcrição de áudio: provider externo ou serviço próprio?
- IA: OpenAI como padrão?

### Produto

- Quais segmentos entram primeiro na biblioteca?
- Quais templates essenciais serão escritos manualmente antes da IA?
- Qual o nível de acesso limitado de funcionário no V1?
- Push/email/WhatsApp entram no V1 ou depois?

---

## 8. Próximo documento necessário

Depois deste plano mestre, criar:

```txt
baase-technical-architecture.md
```

Esse documento deve definir:

- estrutura de app;
- stack;
- entidades;
- rotas;
- permissões;
- integrações com Account API;
- estratégia de IA;
- storage;
- fila/jobs;
- testes;
- deploy.

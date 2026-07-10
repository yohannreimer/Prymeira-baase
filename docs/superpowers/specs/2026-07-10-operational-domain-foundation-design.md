# Fundação do domínio operacional

## Objetivo

Reconstruir a ligação entre áreas, processos, rotinas, tarefas e execução diária
para que o Baase tenha um modelo durável, editável e seguro para crescer. A
mudança deve corrigir referências órfãs, melhorar a geração por IA e transformar
o Hoje em uma visão compacta por rotina e tarefa pontual.

## Princípios

- A rotina é um modelo recorrente; a execução do dia é uma ocorrência imutável.
- Alterações estruturais afetam execuções futuras, não o histórico.
- Evidência é opcional por padrão e obrigatória somente com justificativa.
- Identificadores internos nunca são exibidos como nomes para o usuário.
- Exclusões preservam histórico e exigem tratamento dos vínculos ativos.
- A IA propõe estruturas; regras determinísticas validam antes de persistir.
- Desktop e mobile compartilham o mesmo modelo de interação.

## Fases

### Fase 1: Dados, integridade e edição

Migrar o núcleo operacional armazenado em registros JSON genéricos para tabelas
relacionais do Postgres:

- `areas`
- `people`
- `role_templates`
- `processes`
- `process_versions`
- `process_materials`
- `routines`
- `routine_steps`
- `routine_assignments`
- `task_occurrences`
- `task_checklist_items`
- `task_evidence`
- registros de auditoria

As chaves estrangeiras e regras de serviço impedem referências novas a áreas,
pessoas, cargos, processos ou rotinas inexistentes.

#### Exclusão de área

Uma área com vínculos ativos não é destruída imediatamente. A interface lista
processos, rotinas, cargos e pessoas afetados e exige uma destas ações:

1. transferir os vínculos para outra área; ou
2. deixar os registros permitidos como `Sem área`.

Depois da resolução, a área é arquivada internamente. Execuções históricas
mantêm o nome da área em snapshot. Dados antigos que já apontam para IDs
inexistentes são migrados para `Sem área`; em histórico, quando necessário, a
interface usa `Área removida`. Códigos como `area_3` nunca são exibidos.

#### Processos

Processos ganham campos persistidos e editáveis para:

- área;
- responsável principal por pessoa ou cargo;
- materiais de apoio;
- versões e motivo da alteração.

Materiais aceitam links e arquivos. O armazenamento usa uma interface
compatível com S3. Na VPS, MinIO fornece o primeiro backend com volume
persistente; a mesma interface permite migração futura para Cloudflare R2, AWS
S3 ou serviço equivalente.

Na leitura do processo, responsável e materiais só aparecem quando estão
configurados. Não existem placeholders que pareçam funcionalidades indisponíveis.

#### Rotinas

Cada rotina possui recorrência, responsáveis gerais e etapas ordenadas. Cada
etapa pode sobrescrever:

- responsável;
- prazo real;
- política de evidência;
- aprovação.

O editor permite aplicar uma configuração em massa e depois ajustar etapas
específicas. Mudanças afetam apenas ocorrências futuras; ocorrências iniciadas
preservam o snapshot anterior.

### Fase 2: IA, recorrência e validação

A IA gera uma proposta revisável, não um registro definitivo. A proposta inclui:

- frequência;
- dia, data ou horário aplicável;
- etapas ordenadas;
- responsáveis;
- prazo por etapa quando houver um prazo real;
- evidência e justificativa;
- aprovação.

O usuário pode editar tudo antes de salvar e novamente depois da criação.

#### Regras de recorrência

- `daily`: aceita múltiplos dias da semana.
- `weekly`: exige exatamente um dia da semana.
- `monthly`: exige um dia válido do mês.
- `on_demand`: não gera ocorrência automática no Hoje.

Uma proposta cujo título e conteúdo indiquem frequência semanal não pode ser
salva como diária. Contradições provocam correção ou regeneração antes da
persistência.

#### Evidência

A política inicial é `optional`.

- `comment_required`: somente para justificar decisão, divergência ou bloqueio.
- `photo_required`: somente para comprovação física ou visual.
- `photo_or_comment_required`: somente quando qualquer uma das formas é válida.

Toda exigência gerada pela IA deve ter uma justificativa estruturada. Uma
proposta que torne quase todas as etapas obrigatórias sem motivo é rejeitada e
regenerada. Todas as políticas permanecem editáveis no nível da rotina e da
etapa.

#### Prazo e ordem

Prazo representa hora ou data real. Expressões como `durante a revisão`,
`depois da conferência` e `antes de planejar` pertencem à instrução ou à ordem
da etapa e não são exibidas como `Limite:`.

### Fase 3: Hoje agrupado e execução

O endpoint do Hoje retorna dois grupos principais:

- tarefas pontuais;
- ocorrências de rotinas.

Cada tarefa pontual ou rotina aparece como um único card recolhido, preservando
a estética atual do Baase: tipografia, cores, bordas, densidade e hierarquia.

#### Card de tarefa pontual

- mostra título, área, prazo, prioridade e progresso `x/y`;
- expande para exibir itens do checklist;
- permite marcar itens diretamente;
- abre validação compacta apenas quando uma evidência é exigida;
- conclui quando todo o checklist e as validações estiverem satisfeitos.

#### Card de rotina

- mostra título, área ou público, prazo e progresso `x/y`;
- expande para exibir etapas ordenadas;
- permite concluir etapas simples diretamente;
- exibe estado de etapas aguardando aprovação;
- começa recolhido e preserva o estado aberto durante a navegação atual.

O progresso distingue etapas concluídas, pendentes e aguardando aprovação. Uma
rotina só é concluída quando todas as etapas e aprovações estiverem resolvidas.

#### Conclusão em massa

O checkbox do card da rotina solicita confirmação com a quantidade de etapas.
Depois:

1. valida todas as etapas;
2. apresenta uma única revisão com comentários, fotos ou justificativas faltantes;
3. conclui etapas simples;
4. envia etapas com aprovação para o estado correspondente;
5. atualiza o progresso de forma atômica.

Sem validações pendentes, a confirmação simples é suficiente. A operação é
idempotente para evitar conclusão duplicada em cliques repetidos.

#### Responsividade

No celular, os mesmos cards são apresentados em coluna. A expansão, progresso,
evidências e confirmação em massa continuam disponíveis. Não existe uma
miniatura demonstrativa separada da aplicação real.

## Fluxos de dados

### Geração de rotina

1. Usuário descreve a rotina.
2. IA produz proposta estruturada.
3. Validador verifica recorrência, evidência, prazos e referências.
4. Interface apresenta revisão editável.
5. Usuário confirma.
6. Serviço persiste rotina e etapas em transação.
7. Agendador gera ocorrências somente nas datas aplicáveis.

### Execução diária

1. Agendador cria ocorrência e snapshots das etapas.
2. Hoje carrega tarefas pontuais e ocorrências agrupadas.
3. Usuário expande um card e conclui etapas.
4. Serviço valida evidência e aprovação.
5. Progresso é recalculado transacionalmente.
6. Histórico registra ator, instante e mudanças.

## Migração

1. Criar tabelas e índices novos.
2. Ler registros existentes de `baase_records`.
3. Migrar áreas, pessoas, cargos, processos, rotinas e tarefas.
4. Criar snapshots para ocorrências existentes.
5. Converter referências órfãs em `Sem área`.
6. Comparar contagens e registrar inconsistências.
7. Ativar os novos endpoints somente após validação.

A migração é idempotente e pode ser retomada sem duplicar registros. Antes da
produção, ela roda sobre uma cópia do banco real. O volume atual não é apagado.

## Erros e recuperação

- Falha de upload preserva o formulário e permite tentar novamente.
- Arquivos incompletos não são associados ao processo.
- Conclusão em massa inválida não produz estado parcial silencioso.
- Referências arquivadas retornam rótulos de domínio, nunca IDs internos.
- Falha de geração por IA mantém a proposta anterior quando houver uma.
- Migração registra cada etapa, contagens e registros não convertidos.

## Testes obrigatórios

- exclusão de área com vínculos;
- transferência e remoção de vínculos;
- histórico com área removida;
- edição de responsável e materiais;
- upload, download e remoção de arquivo;
- recorrência diária, semanal, mensal e sob demanda;
- rejeição de semanal com múltiplos dias;
- contradição semântica de frequência gerada pela IA;
- evidência opcional por padrão;
- justificativa obrigatória para evidência exigida;
- criação e edição de políticas por etapa;
- geração de ocorrências sem alterar histórico;
- agrupamento do Hoje;
- progresso individual e em massa;
- conclusão em massa com evidências;
- aprovação pendente;
- tarefa pontual com checklist;
- idempotência de conclusão;
- desktop e mobile;
- migração sobre cópia dos dados de produção.

## Fora de escopo

- Folha de pagamento, controle de ponto ou gestão financeira completa.
- Substituir o provedor de autenticação.
- Criar um editor de documentos completo para materiais.
- Reescrever módulos não relacionados ao domínio operacional.

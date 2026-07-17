# Visibilidade de processos como conhecimento

## Contexto

Funcionários devem consultar processos publicados que pertencem à empresa inteira ou à sua própria área. A execução diária continua separada: o Hoje mostra somente tarefas de rotina ou tarefas particulares atribuídas à pessoa.

Atualmente, a listagem de processos aplica indevidamente a regra de atribuição de tarefas a funcionários. Por isso, um funcionário da área Financeiro e Controle não vê um processo publicado dessa área se não houver uma tarefa atribuída a ele que referencie o processo.

## Decisão

O endpoint de listagem de processos usará a política de leitura por área para todos os papéis:

- Donos veem todos os processos publicados e rascunhos conforme as permissões existentes.
- Funcionários veem somente processos publicados.
- Um processo sem área é visível a todos os funcionários.
- Um processo com área é visível aos funcionários cuja área principal corresponde à área do processo.
- A existência de uma tarefa atribuída que referencia o processo não influencia sua visibilidade.

## Limites

Esta mudança não altera a política de rotinas, ocorrências ou tarefas particulares. Essas continuam exigindo atribuição individual para funcionários, inclusive no Hoje.

Não haverá alteração de esquema, dados existentes, papéis ou escopos de acesso.

## Testes

Cobrir no endpoint `GET /processes` que um funcionário:

1. vê um processo publicado da sua área mesmo sem tarefa vinculada;
2. não vê um processo publicado de outra área;
3. não vê um rascunho da própria área.


# Painel de Acompanhamento Operacional

## Objetivo

Dar ao Dono uma visão global e aos gestores uma visão limitada à própria área para acompanhar execução, aprovações, comunicados obrigatórios e desempenho. O foco é permitir identificar pendências, ver as pessoas envolvidas e navegar para o detalhe sem enviar lembretes ou alterar itens diretamente no painel.

## Experiência

O novo Painel Operacional terá um seletor de período com atalhos de 7 dias, 30 dias e mês atual, além de intervalo personalizado. O período controla indicadores, tendências e listas.

Os indicadores prioritários são:

- Tarefas atrasadas: vencimento anterior à data atual e tarefa ainda não concluída.
- Aguardando aprovação: tarefas no estado `awaiting_approval`.
- Comunicados obrigatórios pendentes: comunicados publicados com `read_confirmation` ou `quiz_confirmation` que ainda não receberam a confirmação exigida da pessoa destinatária.

Cada indicador abre uma lista nominal com pessoa, área, item relacionado, datas relevantes e atraso quando aplicável. A pessoa e o item são navegáveis. O item abre a tarefa ou comunicado existente; a pessoa abre uma página própria de Visão da Pessoa.

## Visão da Pessoa

A página individual mantém o período do painel de origem e permite ajustar o intervalo sem perder o contexto. Ela mostra:

- resumo de tarefas abertas, atrasadas e aguardando aprovação;
- taxa de conclusão no prazo;
- tempo médio até aprovação;
- listas de tarefas relevantes e comunicados obrigatórios ainda pendentes;
- tendências no período selecionado.

Não há lembrete nem ação em massa nesta fase: a finalidade é acompanhar e navegar.

## Permissões

- Dono: todos os dados e qualquer pessoa do workspace.
- Gestor: somente pessoas, tarefas, aprovações e comunicados da área que pode administrar. A API deve aplicar o escopo, inclusive em acesso direto por URL.
- Funcionário: não tem acesso às rotas nem às telas de acompanhamento.

O escopo de comunicados reutiliza a audiência atual (`all`, área, cargo ou pessoa) e as políticas de leitura já existentes. Um comunicado por área, por exemplo, só compõe pendências das pessoas destinatárias daquela área e dentro do escopo de quem consulta.

## API e cálculos

Serão adicionados dois recursos de leitura:

- `GET /operational-overview`: indicadores, tendências e listas nominais para o período.
- `GET /people/:id/operational-overview`: dados detalhados de uma pessoa no mesmo formato de período.

Os recursos usam tarefas, aprovações, pessoas, áreas e recibos de comunicados já persistidos; não criam dados duplicados.

Taxa de conclusão no prazo = tarefas concluídas no prazo divididas por tarefas concluídas com vencimento no período. Tempo até aprovação = intervalo entre submissão e a decisão de aprovar ou devolver para ajuste. A implementação deve definir respostas seguras para denominador zero e para períodos sem aprovações.

## Estados e qualidade

Cada seção tem estado vazio explícito. Listas grandes devem ser pagináveis ou expor “ver mais”. Links preservam o filtro de período no retorno. A implementação deve cobrir cálculos, filtros de data, listas nominais, escopo Dono/Gestor, acesso proibido e navegação para pessoa, tarefa e comunicado.

## Fora de escopo

- Envio de lembretes ou mensagens em massa.
- Ações de alteração de tarefa/comunicado dentro do painel.
- Avaliações subjetivas de desempenho.

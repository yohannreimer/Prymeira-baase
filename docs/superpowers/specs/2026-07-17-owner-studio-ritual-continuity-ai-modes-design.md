# Rituais contínuos e modos de apoio da IA no Estúdio

**Data:** 2026-07-17  
**Status:** desenho aprovado, aguardando revisão final da especificação  
**Escopo:** rituais privados do dono no Estúdio

## 1. Objetivo

Transformar cada ritual em um espaço contínuo de reflexão e registro, no qual o dono responde às perguntas recorrentes e consulta todas as execuções anteriores. A IA deve respeitar a profundidade escolhida para cada ritual: pode apenas registrar, resumir com discrição ou apoiar uma reflexão mais estratégica.

O ritual não é uma tarefa nem uma fábrica automática de ações. Um ritual diário simples deve poder ser respondido e encerrado sem preparação, síntese ou recomendações óbvias. Rituais semanais, mensais ou estratégicos podem receber apoio mais ativo quando o dono assim desejar.

## 2. Problemas observados

1. Uma execução concluída não forma uma experiência histórica clara dentro do ritual que a originou.
2. A síntese final transforma respostas simples em muitas sugestões óbvias e marca todas apenas como `Pendente`.
3. O texto original e a interpretação da IA não estão suficientemente separados na experiência.
4. A preparação da IA pode falhar ou disputar a revisão da sessão com o salvamento das respostas, gerando um falso aviso de conflito entre abas.
5. A conclusão parece depender excessivamente da IA, embora o registro de respostas deva funcionar de forma autônoma.
6. Alterar a profundidade desejada para um ritual não possui um modelo explícito e compreensível.

## 3. Princípios do desenho

1. **Ritual é continuidade.** O ritual é o contêiner permanente; cada dia ou período cria uma execução dentro dele.
2. **Registrar antes de interpretar.** Respostas originais são a fonte primária e nunca são substituídas pela IA.
3. **Profundidade escolhida.** O dono controla o modo de apoio de cada ritual.
4. **Padrões inteligentes, não imposições.** A frequência sugere um modo inicial, mas a pessoa pode trocá-lo.
5. **IA sob demanda quando necessário.** Qualquer registro pode ser aprofundado manualmente, mesmo se tiver sido criado sem IA.
6. **Nenhuma ação silenciosa.** Decisões, metas, planos e tarefas só são criados após confirmação explícita.
7. **Conclusão resiliente.** Falha, lentidão ou indisponibilidade da IA não bloqueia respostas nem conclusão.
8. **Quiet Ops.** A experiência diária é calma, curta e evidente; capacidades avançadas aparecem sob demanda.

## 4. Modelo do produto

### 4.1 Ritual como espaço permanente

Ao abrir um ritual, o dono encontra:

1. cabeçalho com nome, descrição, frequência, próxima execução e modo de apoio;
2. próxima execução ou execução vigente no topo;
3. linha do tempo das execuções anteriores;
4. filtros por período;
5. comparação de períodos para rituais semanais e mensais.

O ritual mantém sua identidade ao longo do tempo. Cada execução possui identidade, data de referência, estado e conteúdo próprios.

### 4.2 Execução

Uma execução preserva:

- perguntas apresentadas;
- respostas originais;
- materiais ou anexos relacionados;
- data e horário;
- modo de apoio utilizado naquela ocasião;
- reflexão ou resumo da IA, quando existir;
- revisões posteriores das respostas;
- estruturas criadas explicitamente a partir dela.

### 4.3 Linha do tempo

A linha do tempo é a visualização principal do histórico. Ela agrupa as execuções por data e permite abrir cada registro sem sair do ritual.

Cada item mostra inicialmente a data, o estado e uma prévia curta. Quando expandido, mostra respostas, materiais e apoio da IA em blocos separados.

Rituais semanais e mensais podem ser comparados entre períodos. A comparação deve destacar mudanças e continuidades sem atribuir julgamento automático a toda diferença.

## 5. Modos de apoio da IA

### 5.1 Só registrar

Comportamento:

- salva exatamente o que foi respondido;
- não prepara contexto automaticamente;
- não cria síntese, agenda ou lista de ações;
- conclui imediatamente após a persistência;
- oferece a ação secundária `Conversar sobre este registro`.

É o padrão sugerido para rituais diários.

### 5.2 Resumo leve

Comportamento:

- preserva integralmente as respostas;
- cria um resumo curto em bloco separado;
- pode destacar uma repetição, mudança ou ponto de atenção relevante;
- não converte respostas em tarefas nem gera uma sequência operacional óbvia;
- permite descartar ou regenerar o resumo.

É o padrão sugerido para rituais semanais.

### 5.3 Reflexão com IA

Comportamento:

- pode preparar contexto a partir de execuções anteriores e conteúdo relacionado do Estúdio;
- pode apresentar perguntas complementares, claramente separadas das perguntas fixas do ritual;
- produz poucos insights relevantes ao final;
- pode sugerir decisão, meta ou plano, sempre como proposta revisável;
- só persiste novas estruturas após confirmação explícita.

É o padrão sugerido para rituais mensais e estratégicos.

### 5.4 Escolha e alteração do modo

A frequência apenas recomenda o modo inicial:

| Frequência | Sugestão inicial |
| --- | --- |
| Diária | Só registrar |
| Semanal | Resumo leve |
| Mensal ou estratégica | Reflexão com IA |

O dono pode escolher qualquer modo na criação ou nas configurações do ritual. A alteração vale somente para as próximas execuções. Registros antigos preservam o modo e o resultado originais.

Qualquer execução histórica oferece `Aprofundar com IA`. Essa análise retroativa só começa após ação explícita e não altera o registro original.

## 6. Fluxo de execução e conclusão

### 6.1 Início

O dono inicia a execução sem depender da IA. Nos modos que usam preparação, o contexto pode ser preparado em segundo plano e aparecer quando estiver disponível.

Se a preparação falhar, as perguntas e respostas continuam funcionando normalmente. A interface informa de forma discreta que o apoio adicional não está disponível e permite tentar novamente sem interromper o ritual.

### 6.2 Respostas

As perguntas definidas pelo dono permanecem estáveis para aquela execução. Perguntas complementares da IA, quando habilitadas, devem ser visualmente identificadas e opcionais.

O rascunho é salvo progressivamente. A interface usa apenas os estados `Salvando`, `Salvo` e `Não foi possível salvar`. Em perda de conexão, o rascunho local é preservado e reconciliado quando possível.

### 6.3 Conclusão

Ao concluir:

1. as respostas são persistidas na execução correta;
2. a execução recebe a data de referência e o estado concluído;
3. a próxima ocorrência é calculada conforme a frequência;
4. a experiência confirma `Ritual registrado`;
5. apoio adicional, quando habilitado, é processado sem bloquear a conclusão.

No modo `Só registrar`, a tela final contém apenas a confirmação, as respostas registradas e uma ação discreta para conversar com a IA.

Nos modos assistidos, resumo ou reflexão aparecem em uma seção independente. O texto nunca se apresenta como se tivesse sido escrito pelo dono.

## 7. Revisão, edição e estruturas derivadas

### 7.1 Edição posterior

Uma execução concluída pode ser editada. Cada alteração:

- preserva a versão anterior;
- registra data e ator;
- marca discretamente o registro como `Editado`;
- não regenera automaticamente análises antigas da IA.

O dono pode solicitar uma nova análise após a edição.

### 7.2 Sugestões acionáveis

Não haverá uma lista genérica de itens eternamente marcados apenas como `Pendente`.

Quando existir uma sugestão da IA, as ações possíveis dependem do conteúdo:

- ignorar;
- guardar como pensamento;
- criar decisão;
- criar meta;
- transformar em plano;
- conversar sobre a sugestão.

Antes da confirmação, a pessoa pode editar título, conteúdo e destino. A criação deve ser idempotente e vinculada à execução que a originou.

## 8. Concorrência e confiabilidade

### 8.1 Separação entre respostas e preparação

Atualizações internas da preparação ou síntese da IA não podem competir com a revisão de respostas do usuário. O modelo deve separar a revisão do conteúdo humano do estado dos trabalhos de IA, ou aplicar controle otimista por recurso independente.

### 8.2 Conflito real

O aviso de conflito entre abas só aparece quando outra edição humana realmente alterou a mesma execução a partir de uma base incompatível. Um job de IA concluído em segundo plano não é considerado outra aba.

Quando houver conflito real, a interface mostra as versões relevantes e permite manter o rascunho local ou carregar a versão remota sem perder conteúdo silenciosamente.

### 8.3 Idempotência

- concluir duas vezes não cria duas execuções;
- iniciar novamente um ritual recorrente no mesmo período exige confirmação;
- aceitar duas vezes uma sugestão não duplica a estrutura;
- reprocessar uma análise substitui ou versiona o resultado conforme intenção explícita;
- atualizar frequência ou modo não altera execuções anteriores.

## 9. Estados de erro

- **IA indisponível:** o ritual permanece plenamente respondível e concluível.
- **Falha ao salvar:** rascunho local preservado, tentativa novamente disponível e conclusão bloqueada apenas enquanto as respostas não estiverem persistidas.
- **Falha de análise:** registro concluído normalmente; análise pode ser solicitada novamente.
- **Conflito verdadeiro:** resolução explícita sem perda silenciosa.
- **Sem histórico:** estado vazio explica que as execuções aparecerão após a primeira conclusão.
- **Análise retroativa em andamento:** registro original continua visível e utilizável.

## 10. Critérios de aceitação

1. Um ritual diário em `Só registrar` pode ser iniciado, respondido e concluído sem chamada de IA.
2. Ao reabrir o ritual, a execução concluída aparece na linha do tempo na data correta.
3. Execuções de dias diferentes permanecem vinculadas ao mesmo ritual e não se sobrescrevem.
4. Alterar o modo afeta apenas execuções futuras.
5. Uma execução antiga pode receber análise retroativa sem modificar respostas originais.
6. Editar uma resposta concluída preserva a versão anterior e mostra `Editado`.
7. Falha da preparação ou síntese não bloqueia nem invalida a conclusão.
8. Atualização de um job de IA não gera aviso de conflito entre abas.
9. Um conflito real entre duas edições humanas oferece resolução explícita.
10. Sugestões da IA possuem destino e ações claros; nenhuma estrutura é criada automaticamente.
11. Conclusão e aceitação de sugestões são idempotentes.
12. Comparação semanal ou mensal usa execuções do ritual correto e respeita o período selecionado.

## 11. Estratégia de testes

### 11.1 Domínio e persistência

- criação de execuções por frequência e período;
- cálculo da próxima ocorrência;
- mudança de modo somente para o futuro;
- versão de respostas editadas;
- idempotência de início, conclusão e criação derivada;
- isolamento por dono e workspace.

### 11.2 Integração

- execução completa nos três modos;
- preparação e análise em background;
- falha e repetição de trabalhos de IA;
- concorrência entre salvamento humano e atualização da IA;
- análise retroativa;
- criação confirmada de pensamento, decisão, meta e plano.

### 11.3 Navegador

- ritual diário simples sem IA;
- histórico com múltiplas datas;
- filtros e comparação;
- edição com versão anterior;
- perda e recuperação de conexão;
- duas abas com conflito real;
- ausência de falso conflito com apenas uma aba;
- falha da IA com conclusão funcional;
- responsividade, teclado, foco e leitores de tela.

## 12. Fora de escopo

- rituais compartilhados com gestores ou funcionários;
- gamificação, ranking ou cobrança de sequência;
- criação automática de tarefas operacionais;
- mudança retroativa em massa do modo de IA;
- dashboard analítico pesado sobre hábitos;
- uso dos rituais do dono como ferramenta de fiscalização da equipe.

## 13. Resultado esperado

O dono pode usar um ritual diário apenas para manter os pés no chão, consultar o que respondeu em cada dia e seguir trabalhando. Quando desejar profundidade, pode aumentar o modo de apoio ou pedir uma análise pontual. Rituais semanais, mensais e estratégicos ganham inteligência sem transformar toda reflexão em execução operacional.

# Estabilização completa do Estúdio do Dono

**Data:** 2026-07-15  
**Status:** desenho aprovado, aguardando aprovação final da especificação  
**Escopo:** experiência privada do dono no Estúdio

## 1. Objetivo

Transformar o Estúdio já existente em uma área realmente confiável para o dono capturar, escrever, anexar materiais, organizar pensamentos, estruturar decisões, metas e planos, encontrar conexões, conversar com IA, executar rituais e exportar os próprios dados.

A rodada não é apenas visual. Ela deve corrigir as causas de falhas no frontend, API, PostgreSQL, workers, IA, armazenamento e implantação. O produto deve manter o princípio de Quiet Ops: interface calma, feedback claro e complexidade técnica escondida sem esconder falhas.

## 2. Problemas confirmados

### 2.1 Versões demais

O editor agenda um autosave após aproximadamente 700 ms. Cada atualização do documento incrementa a revisão e o repositório cria uma versão imutável, além de um trabalho de indexação. Uma pessoa que escreve pausando naturalmente pode gerar dezenas de versões em poucos minutos.

O histórico é renderizado no fluxo normal da página, sem altura máxima, paginação ou virtualização. Isso explica a coluna com cerca de 60 versões e a página excessivamente longa observada.

### 2.2 Materiais desorganizados

Materiais processados renderizam o texto extraído completo diretamente na página. PDFs longos fazem o conteúdo ocupar toda a altura do documento. Ações primárias e secundárias ficam expostas simultaneamente, criando excesso de botões e desalinhamento.

### 2.3 Decisões, metas e planos não aparecem

As estruturas são persistidas corretamente e um documento pode ter mais de uma estrutura. Porém, as rotas visuais de Metas, Decisões e Planos terminam em estados vazios estáticos e não consultam a API de estruturas. O problema é de integração da biblioteca, não de classificação do documento.

### 2.4 Exclusão individual incompleta

Há arquivamento e restauração, mas não existe um fluxo completo de lixeira e exclusão definitiva por documento na interface e na API.

### 2.5 Coleções sem confiança de persistência

A interface aplica a mudança de coleção de forma otimista, mas não confirma a reidratação do estado persistido. Embora rota, serviço e repositório existam, o comportamento relatado precisa ser reproduzido contra PostgreSQL real e protegido por testes de recarregamento e concorrência.

### 2.6 IA indisponível

Os prompts estavam presos ao identificador `gpt-5.5`. O modelo solicitado pelo produto, `gpt-5.6-terra`, foi validado como disponível na conta OpenAI configurada. O modelo precisa deixar de ser uma constante espalhada pelo código e passar a ser configuração de runtime com diagnóstico de prontidão.

Em produção, ausência ou falha da IA não pode cair silenciosamente em respostas mockadas. A escrita e os recursos manuais devem continuar funcionando, mas o estado real da IA deve ser observável.

### 2.7 Conexões semânticas indisponíveis

O adapter de memória de produção exige a extensão `pgvector`, cria tabelas vetoriais sob demanda e depende de embeddings. O compose atual usa `postgres:16-alpine`, que não fornece essa extensão. A indexação pode falhar em background enquanto a interface mostra apenas uma lista vazia.

As flags de prontidão do Studio hoje geram avisos, mas não garantem que a capacidade vetorial esteja disponível.

### 2.8 Ritual bloqueado pela preparação

Quando a preparação da IA falha, a interface prioriza uma tela de falha. O dono deveria conseguir começar o ritual manualmente de imediato, recebendo a preparação quando ela ficar pronta.

### 2.9 Exportação parece não fazer nada

A exportação já é assíncrona, mas o ciclo de vida e o resultado não ficam suficientemente claros. O usuário precisa ver estado, progresso, erro, arquivo gerado, validade e ação de download.

### 2.10 Copiloto sempre aberto

O Copiloto inicia aberto em cada documento e o controle de recolher é pouco explícito. Isso não impede o uso, mas compete com a escrita e não respeita a preferência anterior do dono.

## 3. Princípios do desenho

1. **Um documento, várias leituras.** Decisão, meta, plano e ritual são estruturas aplicadas ao documento original, não cópias em silos.
2. **Salvar não é versionar.** Autosave protege o trabalho atual; checkpoint preserva um marco histórico.
3. **IA auxilia, nunca bloqueia.** Escrita, organização manual e rituais continuam disponíveis sem IA.
4. **Falhas não podem parecer vazio.** Pendente, indisponível, falhou e realmente vazio são estados diferentes.
5. **Ações destrutivas são graduais.** Arquivo, lixeira e exclusão definitiva têm significados distintos.
6. **O original é preservado.** Material, gravação e arquivo-fonte continuam acessíveis mesmo após extração ou transcrição.
7. **Quiet Ops.** Poucas ações primárias visíveis; detalhes aparecem sob demanda.
8. **Privado por padrão.** Todo acesso, índice, exportação e job é isolado por workspace e perfil do dono.

## 4. Arquitetura escolhida

A solução será uma estabilização ponta a ponta sobre o Estúdio existente. Não será um remendo apenas de frontend nem uma reconstrução total.

As mudanças se dividem em cinco eixos:

1. persistência de rascunho e checkpoints;
2. bibliotecas reais de estruturas e ciclo de vida dos documentos;
3. apresentação compacta de materiais e histórico;
4. runtime confiável para IA, embeddings, conexões e processos assíncronos;
5. testes de integração e navegador cobrindo o comportamento implantado.

## 5. Modelo de conteúdo e bibliotecas

### 5.1 Documento como fonte única

O documento continua sendo a fonte única de título, corpo, materiais e conversa com o Copiloto. Estruturas apenas acrescentam significado e propriedades.

Um documento pode ser simultaneamente:

- decisão;
- meta;
- plano;
- ritual.

Não há duplicação de texto nem criação automática de um segundo documento.

### 5.2 Bibliotecas calmas

As abas Decisões, Metas e Planos serão bibliotecas em lista, com:

- título do documento;
- resumo curto quando disponível;
- estado da estrutura;
- horizonte ou data relevante;
- coleções;
- quantidade de conexões quando conhecida;
- busca;
- filtros leves;
- ordenação por atualização, criação ou horizonte.

Selecionar um item abre o documento original. Não haverá dashboard analítico pesado nesta rodada.

### 5.3 Atualização imediata

Criar, alterar ou arquivar uma estrutura deve:

1. persistir no servidor;
2. atualizar o cache do documento;
3. invalidar ou atualizar a biblioteca correspondente;
4. refletir a mudança imediatamente sem recarregar a página.

Se a persistência falhar, a interface restaura o estado anterior e mostra uma mensagem clara.

### 5.4 Coleções

Coleções continuam independentes das estruturas e aceitam associação múltipla.

A interface pode apresentar feedback imediato, mas o estado final deve ser reconciliado com a resposta do servidor. Ao reabrir ou atualizar a página, o vínculo precisa permanecer.

Testes devem cobrir adição, remoção, cliques rápidos, concorrência, recarregamento e isolamento entre donos.

### 5.5 Arquivo, lixeira e exclusão

- **Arquivar:** retira o documento das bibliotecas ativas, mas permite restaurar.
- **Mover para a lixeira:** retira o documento de Entrada, Tudo, coleções e bibliotecas estruturadas.
- **Restaurar da lixeira:** devolve o documento ao estado anterior possível, preservando conteúdo e estruturas.
- **Excluir definitivamente:** remove conteúdo, versões, materiais, estruturas, coleções, conexões e objetos armazenados associados.
- **Expiração automática:** itens na lixeira são elegíveis para exclusão definitiva após 30 dias.

A exclusão definitiva exige confirmação explícita e deve ser idempotente.

## 6. Escrita, autosave e checkpoints

### 6.1 Separação semântica

`studio_documents` continua armazenando o rascunho atual e sua revisão otimista. Atualizar o rascunho não deve criar automaticamente uma linha em `studio_document_versions`.

`studio_document_versions` passa a representar apenas checkpoints preservados.

### 6.2 Quando criar checkpoint

Um checkpoint pode ser criado quando ocorrer:

- pausa significativa após mudanças reais;
- fechamento ou troca de documento com mudanças pendentes;
- alteração de estrutura;
- aceitação de sugestão da IA;
- inserção de transcrição ou extração;
- restauração de uma versão anterior;
- ação explícita “Preservar versão”.

Pequenas alterações consecutivas devem ser agrupadas. Conteúdo idêntico não cria novo checkpoint.

### 6.3 Metadados

Cada checkpoint precisa identificar:

- origem;
- motivo;
- ator;
- horário;
- revisão-base;
- execução de IA relacionada, quando houver.

Origens existentes devem ser preservadas e ampliadas de modo compatível.

### 6.4 Histórico legado

As versões antigas não serão apagadas na migração. Elas aparecerão recolhidas sob “Histórico anterior”. O novo histórico destaca checkpoints criados após a mudança e permite revelar o legado quando necessário.

## 7. Experiência do editor

### 7.1 Layout principal

O corpo do documento mantém prioridade visual. Histórico, materiais e Copiloto não devem aumentar indefinidamente a altura da página.

### 7.2 Materiais compactos com inspetor lateral

No documento, cada material aparece em uma linha ou cartão compacto com:

- ícone e tipo;
- nome;
- estado de processamento;
- tamanho ou duração;
- ação principal contextual.

Ao selecionar o material, um inspetor lateral mostra:

- visualização adequada ao tipo;
- player de áudio, quando aplicável;
- resumo da extração;
- texto completo extraído sob demanda;
- inserir transcrição ou trecho no documento;
- abrir ou baixar original;
- copiar link, quando aplicável;
- excluir material.

PDFs e documentos longos nunca expandem todo o conteúdo no fluxo principal.

### 7.3 Histórico lateral

O histórico abre como painel lateral ou overlay, com:

- altura limitada;
- paginação ou carregamento incremental;
- agrupamento por período;
- motivo do checkpoint;
- prévia das mudanças;
- restauração confirmada.

Restaurar cria um novo checkpoint; não apaga a história posterior.

### 7.4 Copiloto

A preferência aberto/fechado é lembrada por usuário. O controle de recolher e reabrir deve ter rótulo ou tooltip visível e ser acessível por teclado.

## 8. IA do Estúdio

### 8.1 Configuração

O modelo padrão do Estúdio será:

```text
BAASE_STUDIO_AI_MODEL=gpt-5.6-terra
```

O código não deve repetir o identificador nos prompts ou serviços. A configuração é resolvida uma vez no runtime e injetada no harness.

Embeddings permanecem configurados separadamente:

```text
BAASE_STUDIO_EMBEDDING_MODEL=text-embedding-3-small
```

### 8.2 Comportamento em produção

- Sem chave OpenAI, recursos de IA ficam indisponíveis com diagnóstico explícito.
- Produção não usa mock silencioso como se fosse resposta real.
- Modelo inválido, falta de permissão, limite, timeout e schema inválido têm códigos distintos.
- Conteúdo privado não aparece em logs de erro.
- Falhas da IA não impedem editar, salvar, organizar manualmente ou responder um ritual.

### 8.3 Prontidão e observabilidade

O runtime terá verificação de:

- provider configurado;
- modelo configurado;
- acesso ao modelo;
- embeddings;
- extensão vetorial;
- worker ativo;
- fila sem falha permanente acumulada.

O diagnóstico deve ser consumível por health/readiness administrativo e por estados específicos da interface, sem expor detalhes sensíveis ao usuário final.

## 9. Memória e conexões

### 9.1 PostgreSQL com pgvector

O serviço PostgreSQL de produção deve usar uma imagem PostgreSQL 16 com `pgvector`. O volume existente será mantido. A inicialização executará `CREATE EXTENSION IF NOT EXISTS vector` e validará a capacidade antes de declarar o subsistema pronto.

As configurações serão explícitas:

```text
BAASE_STUDIO_ENABLED=true
BAASE_STUDIO_VECTOR_ENABLED=true
```

Se a flag vetorial estiver ativa e a extensão não estiver disponível, o diagnóstico fica degradado e a indexação não pode falhar silenciosamente.

### 9.2 Indexação por checkpoint

Cada checkpoint relevante enfileira uma nova geração de índice. Autosaves intermediários não criam trabalho vetorial.

O job mantém:

- estado;
- tentativas;
- próximo horário de tentativa;
- código do último erro;
- checkpoint esperado;
- lease e idempotência.

Uma geração mais nova substitui a anterior. Documento arquivado ou na lixeira deixa de participar dos resultados.

### 9.3 Busca híbrida

“Encontrar conexões” combina:

- similaridade semântica;
- relevância lexical;
- recência.

Os resultados são isolados por workspace e perfil do dono e excluem o próprio documento.

### 9.4 Estados de interface

A interface diferencia:

- preparando conexões;
- conexões disponíveis;
- nenhuma conexão relevante;
- indexação indisponível;
- indexação falhou;
- documento mudou e está aguardando nova indexação.

## 10. Rituais

Ao iniciar um ritual:

1. a sessão é criada imediatamente;
2. as perguntas base ficam disponíveis;
3. a preparação da IA começa em background;
4. quando pronta, a preparação entra na sessão sem apagar respostas existentes;
5. se falhar, o dono continua e pode tentar novamente.

O estado da preparação é persistido. Atualizar a página não perde preparação, respostas ou indicação de falha.

## 11. Exportação e privacidade

“Preparar exportação” inicia um job e exibe um cartão persistente com:

- estado: aguardando, preparando, pronto, falhou ou expirou;
- horário da solicitação;
- progresso quando mensurável;
- código amigável em caso de erro;
- nome, formato, tamanho e validade do arquivo;
- ação de download;
- ação para gerar novamente.

O arquivo exportado deve ter finalidade explicada: cópia portátil dos dados privados do Estúdio, incluindo documentos e metadados permitidos. Objetos binários podem ser incluídos ou referenciados conforme a política já definida pelo serviço de portabilidade.

## 12. Processos assíncronos

Materiais, limpeza, indexação, exportação e reconciliação devem seguir um padrão comum:

- estado persistido;
- tentativas limitadas;
- backoff;
- lease renovável;
- idempotência;
- erro seguro;
- retomada após reinício;
- sinal de prontidão e atraso da fila.

Nenhuma ação assíncrona pode parecer um clique sem efeito.

## 13. API e dados

As alterações previstas incluem operações explícitas para:

- salvar rascunho sem checkpoint;
- criar checkpoint;
- listar checkpoints paginados;
- listar documentos por tipo de estrutura;
- consultar estado de indexação;
- mover para lixeira;
- restaurar da lixeira;
- excluir definitivamente;
- consultar estado e resultado de exportação;
- consultar diagnóstico do Studio.

As mutações continuam usando revisão otimista. Conflitos retornam estado atual suficiente para a interface reconciliar sem sobrescrever silenciosamente o trabalho do dono.

### 13.1 Migração de status

O status de documento deverá representar, de forma compatível, pelo menos:

- ativo;
- arquivado;
- lixeira.

O momento de entrada na lixeira precisa ser armazenado para retenção de 30 dias.

### 13.2 Migração de checkpoints

O schema de versões recebe metadados de checkpoint sem invalidar versões existentes. Linhas antigas são marcadas ou inferidas como legado.

### 13.3 Migração vetorial

A migração instala/valida `pgvector` e cria as tabelas e índices necessários. O deploy deve falhar de forma diagnóstica ou manter o Studio degradado de forma explícita; nunca declarar conexões prontas quando o pré-requisito estiver ausente.

## 14. Docker e ambiente

O compose de produção deverá:

- usar PostgreSQL 16 com `pgvector`;
- manter o volume externo atual;
- passar as flags do Studio;
- passar o modelo de IA e o modelo de embeddings;
- manter OpenAI, Deepgram e MinIO como configurações separadas;
- incluir healthchecks adequados para banco, API, MinIO e web;
- preservar o bootstrap idempotente do armazenamento.

Uma atualização de imagem não pode recriar nem esvaziar o volume de dados.

## 15. Tratamento de erro

Erros técnicos devem ser mapeados para mensagens úteis, mantendo código e contexto seguro nos logs.

Exemplos:

- modelo indisponível;
- provider sem credencial;
- limite temporário;
- timeout;
- pgvector ausente;
- indexação pendente ou permanentemente falha;
- coleção em conflito;
- versão desatualizada;
- armazenamento indisponível;
- exportação expirada.

Estados vazios só aparecem quando a consulta foi concluída com sucesso e não há conteúdo.

## 16. Testes obrigatórios

### 16.1 Unidade e contrato

- autosave não cria checkpoint a cada digitação;
- regras de checkpoint e deduplicação;
- serialização de estruturas múltiplas;
- lifecycle de lixeira;
- seleção de modelos por runtime;
- mapeamento de erros do provider;
- estados de jobs e retentativas;
- paginação de histórico;
- segurança dos logs.

### 16.2 Integração real

- PostgreSQL 16 com `pgvector`;
- isolamento entre workspaces e donos;
- criação e substituição de embeddings;
- busca híbrida;
- remoção do índice ao arquivar/excluir;
- persistência de coleções após recarregar;
- concorrência de associações;
- MinIO para originais, exportação e limpeza;
- migração sobre banco existente.

### 16.3 Navegador

- marcar documento como Decisão e vê-lo imediatamente na biblioteca;
- aplicar simultaneamente Decisão e Plano sem duplicar documento;
- adicionar/remover coleção e confirmar após atualização;
- arquivar, restaurar, mover para lixeira e excluir;
- escrever continuamente sem gerar dezenas de checkpoints;
- abrir histórico sem aumentar indefinidamente a página;
- navegar por materiais sem expandir PDF completo;
- reproduzir áudio e inserir transcrição explicitamente;
- encontrar conexões após indexação;
- distinguir conexão pendente, vazia e falha;
- iniciar ritual com IA lenta ou indisponível;
- iniciar e baixar exportação;
- recolher e reabrir o Copiloto com preferência persistida.

### 16.4 Falhas deliberadas

- modelo inválido;
- chave ausente;
- embeddings indisponíveis;
- extensão vetorial ausente;
- worker interrompido durante job;
- MinIO indisponível;
- conflito de revisão;
- exportação expirada.

### 16.5 Verificação final

- lint;
- tipos;
- build;
- suíte completa;
- testes de integração;
- testes E2E;
- revisão visual responsiva;
- acessibilidade por teclado e leitor de tela;
- smoke test no ambiente implantado;
- smoke test opt-in real com `gpt-5.6-terra`.

## 17. Critérios de aceitação

A rodada só termina quando:

1. um documento classificado aparece imediatamente em todas as bibliotecas correspondentes;
2. coleções persistem após atualização;
3. documentos podem ser arquivados, restaurados, enviados à lixeira e excluídos;
4. escrever por vários minutos não gera dezenas de versões visíveis;
5. histórico e materiais permanecem compactos;
6. PDF longo não é despejado no fluxo principal;
7. `gpt-5.6-terra` responde no Estúdio ou a falha real é claramente diagnosticada;
8. conexões funcionam em PostgreSQL com `pgvector` e têm estados honestos;
9. ritual manual funciona sem depender da preparação da IA;
10. exportação mostra progresso e produz download;
11. todos os dados permanecem isolados por dono e empresa;
12. testes locais e smoke test implantado passam.

## 18. Fora do escopo

- liberar o Estúdio para gestores ou funcionários;
- transformar bibliotecas em dashboards analíticos;
- colaboração simultânea entre vários donos no mesmo documento;
- publicar automaticamente decisões, metas ou planos na operação;
- substituir o editor atual por outro framework;
- apagar automaticamente as versões legadas durante a migração.

## 19. Decisões aprovadas

- rodada única cobrindo materiais, versões, biblioteca, lifecycle, rituais, exportação, IA e conexões;
- materiais compactos com inspetor lateral, opção A;
- bibliotecas calmas para Decisões, Metas e Planos, opção A;
- checkpoints inteligentes em vez de versão por autosave;
- estruturas múltiplas no mesmo documento;
- coleções múltiplas e independentes;
- arquivo reversível, lixeira e retenção de 30 dias;
- ritual inicia imediatamente e prepara IA em background;
- estabilização ponta a ponta em vez de remendo visual ou reconstrução total;
- `gpt-5.6-terra` como modelo padrão configurável do Estúdio;
- PostgreSQL de produção com `pgvector`;
- testes reais e smoke test implantado como condição de conclusão.

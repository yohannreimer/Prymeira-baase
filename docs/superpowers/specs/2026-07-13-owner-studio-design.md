# Prymeira Baase — Estúdio do Dono

Atualizado em: 2026-07-13

Status: desenho aprovado para planejamento de implementação

## 1. Resumo

O Estúdio do Dono é uma área privada, textual e assistida por IA para o dono pensar, registrar, organizar e planejar no próprio ritmo.

Ele não é um segundo painel operacional, um gerenciador de tarefas, um sistema de OKRs nem um chatbot genérico. É um escritório particular dentro do Baase: confortável para escrita livre, capaz de ganhar estrutura estratégica quando isso ajuda e conectado à realidade operacional da empresa sem misturar reflexão com execução.

Fluxo central:

    captura livre
      -> conteúdo original preservado
      -> reflexão e organização opcionais
      -> sugestão separada da IA
      -> revisão do dono
      -> conteúdo continua livre, ganha estrutura estratégica ou vira execução confirmada

O Estúdio deve provocar a sensação: “eu joguei tudo aqui e ele realmente entendeu”.

## 2. Objetivos

1. Dar ao dono um lugar seguro para tirar pensamentos da cabeça sem preencher formulários.
2. Permitir escrita e planejamento livres, sem obrigar tipo, prazo, número ou progresso.
3. Oferecer estruturas opcionais para metas, decisões, planos e rituais.
4. Usar IA como copiloto de raciocínio, nunca como autora soberana do conteúdo.
5. Relacionar reflexões com documentos anteriores e fatos operacionais do Baase.
6. Permitir pesquisa pública apenas quando solicitada, sempre com fontes.
7. Transformar clareza estratégica em operação somente após revisão explícita.
8. Manter a linguagem visual quiet ops do produto: calma, bonita, fluida, lógica e confiável.

## 3. Não objetivos

O primeiro lançamento não inclui:

- acesso de gestores ou funcionários;
- compartilhamento entre donos;
- comentários ou colaboração em tempo real;
- publicação ou criação autônoma pela IA;
- aplicativo móvel nativo;
- integração com Slack, Notion, Google Drive ou similares;
- gestão completa de projetos, OKRs ou planejamento financeiro;
- gamificação, pontuação subjetiva ou notificações invasivas;
- substituição das áreas operacionais já existentes no Baase.

## 4. Decisões validadas

- A área é exclusiva de usuários com papel de dono.
- Cada dono tem um Estúdio pessoal; outros donos da mesma empresa não o enxergam.
- O conteúdo é privado por padrão e não existe compartilhamento no primeiro lançamento.
- A experiência combina captura livre, planejamento estratégico, rituais e IA.
- O conteúdo original é preservado; a IA cria propostas separadas.
- A IA é silenciosa por padrão e sua proatividade é configurável.
- Metas podem ser textuais, mensuráveis ou uma combinação dos dois formatos.
- A IA pode consultar dados operacionais, exibindo fontes, período e horário da consulta.
- A IA pode pesquisar a internet somente após solicitação explícita do dono.
- Capturas aceitam texto, áudio, arquivos, imagens e links.
- Nada vira tarefa, rotina, processo ou comunicado sem prévia e confirmação.
- A página inicial segue o modelo Mesa tranquila; páginas abertas seguem o modelo Caderno aberto.
- A IA aparece como copiloto lateral recolhível e não domina a tela.
- O visual reutiliza o design system, a linguagem e os padrões do restante do Baase.

## 5. Princípios de experiência

### 5.1 Liberdade antes de estrutura

Toda captura começa sem tipo. O dono não precisa decidir se algo é pensamento, pendência, meta ou plano antes de escrever.

### 5.2 Progressão opcional

Campos, indicadores, prazos e relações aparecem somente quando o dono os ativa ou aceita uma sugestão.

### 5.3 IA sob controle

A IA pode resumir, organizar, questionar, conectar, pesquisar e propor. Ela não sobrescreve o texto original, não publica e não cria operação sozinha.

### 5.4 Quiet ops

- sem placares ou percentuais artificiais;
- sem alertas agressivos;
- sem cartões genéricos de “insight”;
- sem frases motivacionais vazias;
- sem animação decorativa;
- hierarquia clara, poucos controles simultâneos e movimento sutil;
- estados vazios que convidam, sem cobrar.

### 5.5 Fato, inferência e sugestão

Toda resposta que usar contexto deve diferenciar:

- fato registrado;
- inferência produzida pela IA;
- sugestão de próximo passo;
- lacuna de informação.

## 6. Arquitetura de informação

### 6.1 Navegação principal

O item Estúdio aparece na sidebar somente para o papel owner. Não aparece desabilitado para gestores ou funcionários.

### 6.2 Navegação interna

- Início: Mesa tranquila.
- Entrada: capturas ainda não revisadas.
- Tudo: histórico completo com busca e filtros.
- Metas: conteúdos que ganharam estrutura de meta.
- Decisões: escolhas registradas com contexto e motivo.
- Planos: caminhos estratégicos sem obrigação de virar checklist.
- Rituais: práticas privadas e sessões anteriores.
- Coleções: agrupamentos livres definidos pelo dono.
- Arquivo: conteúdo arquivado e recuperável.

Entrada e Tudo são visões do mesmo acervo. Metas, decisões, planos e rituais são estruturas aplicadas sobre documentos, não silos independentes.

## 7. Página inicial — Mesa tranquila

A página inicial prioriza retomada e captura, sem parecer um dashboard de cobrança.

Ordem recomendada:

1. Saudação curta e contextual, sem texto motivacional.
2. Compositor universal para texto, áudio, imagem, arquivo ou link.
3. Continue de onde parou.
4. Em foco, definido pelo próprio dono.
5. Pensamentos recentes.
6. Próximo ritual, somente quando configurado.
7. Sugestões discretas da IA, somente quando a proatividade correspondente estiver ativa.

Não exibir na home:

- quantidade de pensamentos “atrasados”;
- taxa de produtividade;
- score estratégico;
- ranking;
- sequência de dias;
- metas vermelhas apenas por falta de atualização.

## 8. Editor — Caderno aberto

O editor é a superfície principal para escrita e reflexão.

Requisitos:

- título opcional, sugerido sem ser imposto;
- corpo em editor rico com armazenamento estruturado e snapshot textual;
- autosave com estado visível e recuperação;
- histórico de versões;
- anexos no fluxo do documento;
- seleção de texto com ações contextuais de IA;
- links para estruturas, coleções e conteúdos relacionados;
- painel lateral de IA recolhível;
- largura e tipografia orientadas a leitura;
- atalhos de teclado consistentes;
- suporte responsivo sem perder a área de escrita.

O conteúdo gerado pela IA entra no documento apenas após uma ação explícita do dono. O aceite cria uma nova versão identificada como conteúdo aceito da IA; nunca modifica retroativamente uma versão anterior.

## 9. Captura universal

### 9.1 Texto

Cria o documento imediatamente. Título, tipo e coleção são opcionais.

### 9.2 Áudio

- upload privado ou gravação direta;
- salvamento do áudio antes de iniciar a transcrição;
- transcrição progressiva quando possível;
- áudio permanece acessível ao lado da transcrição;
- falha de transcrição não elimina a captura;
- o dono pode corrigir o texto antes de pedir análise.

### 9.3 Arquivo e imagem

- upload por URL assinada;
- extração de texto quando o formato permitir;
- análise visual quando solicitada;
- arquivo original sempre preservado;
- formatos não processáveis continuam disponíveis para consulta manual.

### 9.4 Link

- validação de URL HTTP ou HTTPS;
- bloqueio de rede privada e proteção contra SSRF;
- limite de tamanho, tempo e redirecionamentos;
- snapshot de título, texto extraído e data de consulta;
- conteúdo externo identificado como fonte não confiável e nunca tratado como instrução de sistema.

## 10. Estruturas estratégicas

### 10.1 Meta

Campos opcionais:

- resultado desejado;
- motivo;
- horizonte ou data-alvo;
- indicador e alvo;
- valor atual;
- evidências de avanço;
- estado livre: em foco, em espera, alcançada ou arquivada.

Uma meta não precisa de número, prazo ou percentual.

### 10.2 Decisão

Campos opcionais:

- decisão tomada;
- contexto;
- alternativas consideradas;
- motivo;
- data;
- hipótese ou risco;
- momento de revisão;
- efeitos e aprendizados posteriores.

### 10.3 Plano

Um plano organiza direção, hipóteses, frentes e marcos. Seus itens não são tarefas operacionais por padrão. Qualquer conversão em execução passa pela ponte operacional.

### 10.4 Ritual

Campos:

- nome e intenção;
- cadência opcional;
- horário e fuso;
- perguntas guia;
- fontes internas autorizadas;
- pesquisa externa permitida ou não;
- proatividade e lembrete;
- formato da síntese;
- próxima execução.

Cada execução cria uma sessão privada com contexto preparado, respostas, síntese e sugestões pendentes.

## 11. Momentos obrigatórios de “WOW”

### 11.1 Captura sem atrito

O dono consegue falar, anexar e sair. O material fica salvo mesmo se o processamento posterior falhar.

### 11.2 Entendimento além do resumo

A IA identifica tensões, hipóteses, decisões adiadas, perguntas e lacunas. Ela não repete o texto em outras palavras como se isso fosse análise.

### 11.3 Memória que conecta

O Estúdio encontra temas semelhantes entre documentos separados no tempo e explica por que considera a relação relevante.

### 11.4 Empresa como contexto

Reflexões podem ser confrontadas com fatos operacionais. A resposta mostra recurso, período, horário da consulta e diferença entre dado e interpretação.

### 11.5 Ritual preparado

Ao começar uma revisão, o dono encontra mudanças, temas recorrentes, decisões abertas e sinais operacionais já reunidos.

### 11.6 Clareza que vira movimento

Uma conclusão pode gerar estrutura estratégica e, depois, uma prévia operacional completa. A origem permanece rastreável nos dois lados.

## 12. Modelo de domínio

O Estúdio deve ser um módulo de domínio próprio. Conteúdo não pode depender da disponibilidade da IA.

### 12.0 Persistência

O domínio usa tabelas relacionais próprias adicionadas por migration ao schema operacional. Não adicionar o Estúdio como novos kinds genéricos em baase_records.

Decisões:

- JSONB é usado apenas onde a forma é naturalmente rica ou versionada, como body_json, metric_json e properties_json;
- campos consultados, ordenados, autorizados ou usados por jobs permanecem em colunas próprias;
- chaves e referências internas incluem workspace_id e owner_profile_id para impedir relações cruzadas entre donos por construção;
- busca textual usa índice PostgreSQL derivado de body_text;
- memória semântica fica atrás da interface StudioMemoryIndex;
- o adapter de produção usa pgvector ou capacidade vetorial equivalente do PostgreSQL;
- testes e demo sem banco usam adapters determinísticos em memória;
- índice textual e vetorial são derivados e reconstruíveis; nunca substituem documentos e versões.

### 12.1 studio_documents

Documento canônico criado ou editado pelo dono.

Campos principais:

- id;
- workspace_id;
- owner_profile_id;
- title;
- body_json;
- body_text;
- revision inteiro crescente para concorrência otimista;
- capture_mode: text, audio, file, image, link ou mixed;
- inbox_state: pending_review ou reviewed;
- status: active ou archived;
- created_at;
- updated_at;
- archived_at.

Índices obrigatórios:

- workspace_id + owner_profile_id + updated_at;
- workspace_id + owner_profile_id + inbox_state;
- workspace_id + owner_profile_id + status.

### 12.2 studio_document_versions

Histórico imutável de conteúdo.

Campos:

- id;
- workspace_id;
- owner_profile_id;
- document_id;
- version_number;
- body_json;
- body_text;
- origin: user, import ou accepted_ai_suggestion;
- actor_profile_id;
- ai_run_id opcional;
- created_at.

A primeira versão original só pode desaparecer por exclusão explícita do dono conforme a política de retenção.

### 12.3 studio_assets

- id;
- workspace_id;
- owner_profile_id;
- document_id;
- kind: audio, image, file ou link_snapshot;
- display_name;
- object_key privado;
- source_url opcional;
- mime_type;
- size_bytes;
- extraction_status;
- extracted_text;
- extraction_metadata;
- created_at;
- updated_at.

### 12.4 studio_collections e studio_collection_items

Coleções são livres e pertencem a um único dono. Um documento pode aparecer em várias coleções sem duplicação.

### 12.5 studio_structures

Camada opcional aplicada a um documento.

Campos:

- id;
- workspace_id;
- owner_profile_id;
- document_id;
- kind: goal, decision, plan ou ritual;
- lifecycle_status;
- horizon_at opcional;
- metric_json opcional;
- cadence_json opcional;
- next_run_at opcional;
- properties_json validado por schema por tipo;
- created_at;
- updated_at;
- archived_at.

Campos usados para busca, agenda ou integridade devem possuir colunas próprias. properties_json não substitui colunas indexáveis.

### 12.6 studio_relations

Conecta documentos e estruturas do próprio Estúdio.

Tipos iniciais:

- related_to;
- supports;
- contradicts;
- originated;
- informs;
- supersedes.

Relações sugeridas pela IA só são persistidas após aceite.

### 12.7 studio_operational_links

Conecta um documento ou estrutura a um recurso operacional.

Campos:

- source_document_id ou source_structure_id;
- resource_type: task, routine, process ou announcement;
- resource_id;
- relation_type: references, informed ou created;
- created_by_profile_id;
- created_at.

### 12.8 studio_conversations e studio_messages

Conversas são vinculadas ao dono e, opcionalmente, a um documento. Mensagens guardam papel, conteúdo, referências, ai_run_id, status e timestamps.

### 12.9 studio_suggestions

Representa propostas revisáveis da IA.

Campos:

- id;
- workspace_id;
- owner_profile_id;
- document_id opcional;
- conversation_id opcional;
- ai_run_id;
- kind;
- payload_json validado;
- status: pending, accepted, dismissed ou expired;
- accepted_version_id opcional;
- created_at;
- decided_at.

Transições válidas:

    pending -> accepted
    pending -> dismissed
    pending -> expired

Aceitar ou ignorar é idempotente. Uma sugestão decidida não pode ser reaplicada.

### 12.10 studio_citations

Referências usadas por mensagens ou sugestões.

Tipos:

- studio_document;
- studio_asset;
- operational_resource;
- operational_metric;
- external_url.

Cada citação contém rótulo, identificador ou URL, trecho seguro, data de observação, período analisado e metadados necessários para reabrir a origem.

### 12.11 studio_ritual_sessions

Registra início, contexto preparado, respostas, síntese, sugestões e encerramento de cada ritual.

### 12.12 studio_memory_chunks

Índice derivado por versão de documento:

- document_id e version_id;
- chunk_index;
- content_text;
- embedding;
- embedding_model e index_version;
- created_at.

Esse índice pode ser reconstruído e nunca é a fonte canônica do conteúdo.

## 13. Isolamento e autorização

Toda operação deve obter workspace_id e profile_id do contexto autenticado. O client nunca escolhe a fronteira de acesso.

Regra de leitura e escrita:

    role == owner
    AND record.workspace_id == auth.workspace_id
    AND record.owner_profile_id == auth.profile_id

canEditCompanyBase já expressa a permissão de papel owner e pode ser reutilizada na entrada das rotas, mas não substitui o filtro por owner_profile_id.

Requisitos:

- nenhum endpoint lista o conteúdo de todos os donos;
- buscas, anexos, memória, sugestões e conversas usam o mesmo escopo;
- URLs assinadas têm curta duração e são geradas após autorização;
- jobs carregam workspace_id e owner_profile_id como escopo obrigatório;
- logs e resumos técnicos não armazenam o corpo integral do documento;
- gestores e funcionários recebem 403 na API e não recebem a rota no frontend;
- testes cobrem vazamento entre empresas e entre dois donos da mesma empresa.

Se o usuário perder o papel owner, o acesso é removido imediatamente. O acervo permanece isolado e não é transferido automaticamente a outro dono. Exclusão, exportação ou recuperação administrativa futura exigem uma política específica, auditada e fora do fluxo comum da aplicação.

Não existe tela de administração capaz de abrir o conteúdo privado de todos os donos. Qualquer mecanismo excepcional de suporte ou compliance deverá ser desenhado posteriormente como acesso break-glass, com justificativa e auditoria, e não faz parte desta versão.

## 14. Superfície de API

Rotas de domínio propostas:

    GET    /studio/home
    GET    /studio/documents
    POST   /studio/documents
    GET    /studio/documents/:documentId
    PATCH  /studio/documents/:documentId
    DELETE /studio/documents/:documentId
    POST   /studio/documents/:documentId/archive
    POST   /studio/documents/:documentId/restore
    GET    /studio/documents/:documentId/versions

    POST   /studio/assets/upload-url
    POST   /studio/documents/:documentId/assets
    DELETE /studio/assets/:assetId

    GET    /studio/collections
    POST   /studio/collections
    PATCH  /studio/collections/:collectionId
    DELETE /studio/collections/:collectionId
    PUT    /studio/collections/:collectionId/documents/:documentId
    DELETE /studio/collections/:collectionId/documents/:documentId

    GET    /studio/structures
    POST   /studio/documents/:documentId/structures
    PATCH  /studio/structures/:structureId
    DELETE /studio/structures/:structureId

    GET    /studio/rituals/:ritualId/sessions
    POST   /studio/rituals/:ritualId/sessions
    PATCH  /studio/ritual-sessions/:sessionId
    POST   /studio/ritual-sessions/:sessionId/finish

    GET    /studio/search
    GET    /studio/documents/:documentId/related

    POST   /studio/assistant/turns
    POST   /studio/suggestions/:suggestionId/accept
    POST   /studio/suggestions/:suggestionId/dismiss
    POST   /studio/suggestions/:suggestionId/operation-preview
    POST   /studio/suggestions/:suggestionId/operation-confirm

Listagens usam cursor, limite e filtros. Escritas relevantes aceitam chave de idempotência. O endpoint de assistência transmite a resposta por SSE, mas persiste a mensagem final e a execução de IA antes de encerrar o stream.

Rotas de portabilidade e privacidade:

    POST   /studio/export
    DELETE /studio/data

O export é assíncrono e gera pacote privado por tempo limitado. A exclusão total exige confirmação reforçada, remove conteúdo e índices privados conforme a política de retenção e nunca apaga recursos operacionais previamente criados.

## 15. Integração com o AI Harness

O harness continua sendo a única entrada para providers de IA.

### 15.1 Extensões de tipo

Nova origem:

    owner_studio

Novos tipos de tarefa:

- studio_assist;
- studio_organize;
- studio_synthesize;
- studio_connect;
- studio_strategic_review;
- studio_ritual_prepare;
- studio_operational_draft;
- studio_external_research;
- studio_memory_embedding.

### 15.2 Agentes

- owner_studio_companion: conversa e raciocínio geral;
- studio_librarian: organização, títulos, coleções e relações;
- studio_strategist: metas, decisões, planos e cenários;
- studio_ritual_facilitator: preparação e síntese de rituais;
- studio_operations_bridge: prévias estruturadas para recursos operacionais.

Cada agente possui prompt versionado, schema de saída quando produzir proposta e conjunto mínimo de ferramentas.

### 15.3 Capacidades do harness

O harness atual suporta geração estruturada e transcrição. O Estúdio exige acrescentar:

- streaming de texto com auditoria de AiRun;
- geração de embeddings por interface de provider;
- pesquisa externa explicitamente autorizada;
- tool calls allowlisted para leitura operacional;
- cancelamento de streams;
- orçamento e limites por execução;
- correlação entre resposta narrativa, sugestão estruturada e citações.

Uma conversa pode transmitir texto livre, mas qualquer mudança proposta deve passar por uma execução estruturada validada por Zod.

### 15.4 Estado da execução

AiRun continua representando o estado técnico da chamada. O estado pending, accepted ou dismissed pertence a studio_suggestions. Não sobrecarregar AiRun para representar revisão de produto.

## 16. Contexto operacional e citações

O Estúdio não entrega o workspace inteiro ao modelo. Um StudioContextBuilder monta snapshots mínimos, orientados pela pergunta e pelas permissões.

Fontes internas permitidas no primeiro lançamento:

- painel operacional e indicadores por período;
- tarefas e estados relevantes;
- rotinas e execuções;
- processos;
- treinamentos;
- comunicados e recibos;
- áreas e pessoas quando necessários para a pergunta.

Regras:

- respeitar filtros e semântica dos serviços de domínio existentes;
- preferir agregados antes de registros individuais, salvo solicitação explícita;
- registrar período, horário, recurso e consulta usados;
- nunca permitir que a IA grave diretamente nos repositórios operacionais;
- tratar conteúdo de usuário, anexos, links e campos operacionais como dados, não instruções;
- limitar tamanho e quantidade de contexto;
- declarar quando os dados forem insuficientes ou possivelmente desatualizados.

Exibição no frontend:

- fatos acompanhados de fonte clicável;
- inferências visualmente diferenciadas;
- pesquisa externa separada de dados internos;
- origem aberta em nova navegação segura ou no recurso correspondente;
- período e horário disponíveis sem poluir a leitura principal.

## 17. Pesquisa externa

Pesquisa pública só acontece quando a mensagem ou ação contém consentimento explícito para aquela execução.

Requisitos:

- o client envia allow_external_research=true apenas após ação do dono;
- o servidor não reutiliza consentimento indefinidamente;
- resultados contêm URL, título, data de publicação quando disponível e data da consulta;
- fontes externas ficam separadas das internas;
- a resposta informa incerteza e conflitos entre fontes;
- nenhum resultado externo é persistido como fato da empresa sem aceite;
- conteúdo remoto não pode acionar ferramentas nem alterar instruções do agente.

## 18. Memória semântica

Depois de cada versão salva, um job cria chunks e embeddings. A busca relacionada combina:

- correspondência lexical;
- similaridade vetorial;
- recência;
- relações aceitas pelo dono;
- estruturas e coleções em comum.

O índice é sempre filtrado por workspace_id e owner_profile_id antes da ordenação.

Uma conexão automática é apresentada como sugestão com explicação curta, por exemplo: “Esta preocupação apareceu em quatro registros desde março”. O sistema não cria relações definitivas nem reclassifica documentos sozinho.

O índice precisa suportar reprocessamento por versão de modelo, remoção por documento e reconstrução completa.

## 19. Proatividade e rituais

Configurações de proatividade são privadas por dono e começam desligadas.

Sinais iniciais configuráveis:

- lembrete de ritual;
- meta escolhida pelo dono sem atualização por período configurado;
- tema recorrente em capturas;
- decisão registrada com data de revisão;
- mudança operacional relacionada a uma meta ou plano;
- sugestão de retomar conteúdo marcado como em foco.

Regras:

- consolidar sinais em vez de emitir muitas notificações;
- permitir silenciar por tipo;
- permitir adiar sem penalidade visual;
- explicar por que o sinal apareceu;
- não inferir urgência humana a partir de silêncio;
- não transformar reflexão em pendência operacional.

Job de preparação de ritual:

    agenda do dono
      -> seleciona ritual ativo
      -> carrega última sessão
      -> recupera documentos e estruturas relevantes
      -> consulta fontes operacionais autorizadas
      -> gera briefing estruturado
      -> salva como sugestão da sessão
      -> notifica de forma discreta se habilitado

## 20. Ponte estratégica para operação

A ponte deve chamar serviços de aplicação ou comandos oficiais dos domínios existentes. É proibido inserir diretamente nas tabelas de tarefa, rotina, processo ou comunicado.

Fluxo:

1. O dono pede ou aceita “transformar em execução”.
2. studio_operations_bridge gera um draft estruturado.
3. O backend valida o schema e referências de área, pessoa, cargo e prazo.
4. O frontend mostra prévia completa e campos faltantes.
5. O dono edita e confirma.
6. Uma chave de idempotência acompanha a confirmação.
7. O serviço operacional cria o recurso.
8. studio_operational_links registra a origem.
9. O documento recebe uma referência, sem mudar automaticamente de estado.

Tipos iniciais:

- tarefa pontual;
- rotina;
- processo em rascunho;
- comunicado em rascunho.

Um plano com várias frentes não deve gerar dezenas de tarefas em uma única confirmação silenciosa. A prévia mostra quantidade e conteúdo de tudo que será criado.

## 21. Frontend e design system

O frontend React/Vite existente continua como base. O Estúdio não cria uma aplicação paralela nem outro sistema visual.

Regras:

- reutilizar shell, sidebar, cabeçalho, tipografia, cores, raios, bordas e tokens existentes;
- extrair componentes compartilhados quando o Estúdio revelar duplicação legítima;
- manter navegação interna secundária dentro da área de conteúdo;
- copiloto lateral recolhível em desktop e painel modal em telas menores;
- compositor universal reutilizado na home e em estados vazios;
- editor carregado sob demanda para não aumentar o bundle inicial de outras rotas;
- listas e documentos grandes usam paginação ou virtualização quando necessário;
- respostas da IA aparecem em streaming com redução de movimento respeitada;
- skeletons preservam a geometria final;
- toasts não substituem estados persistentes de salvamento ou erro.

Componentes conceituais:

- StudioHome;
- StudioNavigation;
- UniversalCaptureComposer;
- StudioDocumentEditor;
- StudioCopilotPanel;
- StudioSuggestionCard;
- StudioCitationList;
- StudioStructurePanel;
- GoalDetails;
- DecisionDetails;
- PlanDetails;
- RitualBuilder;
- RitualSession;
- OperationPreview;
- RelatedThoughts;
- StudioSearch.

O formato persistido do editor deve ser versionado e independente o suficiente para permitir troca de biblioteca sem perder o snapshot textual.

## 22. Estados, falhas e recuperação

### 22.1 Autosave

- debounce curto para alterações comuns;
- fila local enquanto uma gravação está em voo;
- controle otimista com updated_at ou versão;
- conflito gera recuperação explícita, nunca sobrescrita silenciosa;
- indicador: salvando, salvo, offline ou falha;
- rascunho local temporário quando a rede cair.

### 22.2 IA indisponível

- editor e navegação continuam funcionais;
- mensagem explica que o conteúdo está salvo;
- ação pode ser tentada novamente sem duplicar sugestão;
- nenhuma falha de IA remove texto, áudio ou arquivo.

### 22.3 Anexo em processamento

- exibir estado por anexo;
- permitir continuar escrevendo;
- falha pode ser reprocessada ou removida;
- análise da IA informa quando um anexo ainda não estava disponível.

### 22.4 Streaming interrompido

- persistir somente mensagem final válida ou marcar a incompleta;
- permitir continuar ou regenerar;
- execução técnica registra cancelamento ou falha;
- sugestão estruturada incompleta nunca fica aceitável.

### 22.5 Exclusão

- confirmação clara;
- remoção de índice de memória e links privados;
- anexos seguem política de retenção e limpeza;
- recursos operacionais já criados não são apagados em cascata;
- vínculo operacional pode exibir “origem excluída”.

## 23. Segurança e privacidade

- autorização server-side em todas as rotas;
- isolamento por workspace e owner_profile_id;
- arquivos privados com URLs assinadas curtas;
- limites de tipo e tamanho de upload;
- verificação de conteúdo e política antivírus antes de processamento produtivo;
- proteção SSRF em links;
- conteúdo externo e anexos tratados como dados não confiáveis;
- ferramentas allowlisted por agente;
- sem execução de código enviado pelo usuário;
- segredos fora de prompts, logs e respostas;
- minimização do contexto enviado ao provider;
- exportação e exclusão dos dados do Estúdio;
- auditoria de chamadas, ferramentas, fontes e aceite de sugestões;
- rate limit e orçamento por dono e workspace;
- redaction de PII em observabilidade quando aplicável.

## 24. Observabilidade e métricas de produto

Métricas técnicas:

- latência de autosave;
- taxa de conflito;
- falha de upload, extração, transcrição e indexação;
- primeiro token e duração de stream;
- falha de schema da IA;
- custo por tipo de tarefa;
- falha e duplicação na ponte operacional;
- atraso de preparação de ritual.

Métricas de produto, sem medir o conteúdo privado:

- donos que criaram ao menos uma captura;
- retorno ao Estúdio em sete e trinta dias;
- capturas por modalidade;
- sugestões aceitas, ignoradas e editadas antes do aceite;
- uso de fontes internas e pesquisa externa;
- rituais iniciados e concluídos;
- conteúdos transformados em estrutura;
- prévias operacionais confirmadas;
- tempo até a primeira experiência de valor.

Não registrar corpo de documento, mensagem ou transcrição em analytics.

## 25. Testes

### 25.1 Domínio e repositório

- criação, edição, versionamento, arquivo e restauração;
- coleções sem duplicar documento;
- propriedades validadas por tipo de estrutura;
- transições idempotentes de sugestão;
- remoção e reconstrução do índice;
- referências e exclusões sem cascata indevida.

### 25.2 Autorização

- owner acessa o próprio Estúdio;
- segundo owner do mesmo workspace não acessa;
- owner de outro workspace não acessa;
- manager e employee recebem 403;
- busca, asset, SSE, ritual e job respeitam o mesmo escopo;
- IDs manipulados no client não atravessam a fronteira.

### 25.3 IA

- prompts e schemas registrados;
- saída inválida não cria sugestão aceitável;
- citação aponta para fonte realmente consultada;
- fato e inferência permanecem separados;
- pesquisa externa exige consentimento por execução;
- falha de provider preserva conteúdo;
- prompt injection em link ou anexo não aciona ferramenta proibida;
- mock provider reproduz cenários de sucesso, falha, cancelamento e schema inválido.

### 25.4 Ponte operacional

- prévia não cria recurso;
- confirmação cria uma vez;
- referência inválida bloqueia confirmação;
- recurso usa o serviço oficial do domínio;
- origem estratégica fica rastreável;
- exclusão do documento não apaga operação criada.

### 25.5 Frontend

- sidebar visível apenas para owner;
- captura por todas as modalidades;
- autosave e recuperação offline;
- editor e painel de IA por teclado;
- aceite, edição e descarte de sugestão;
- fontes internas e externas distinguíveis;
- layouts desktop, tablet e mobile web;
- reduced motion, foco, contraste e leitores de tela;
- empty, loading, error e retry states.

### 25.6 E2E obrigatório

1. Dono grava áudio, sai da tela, retorna e encontra áudio e transcrição.
2. Dono escreve livremente, pede organização, revisa e aceita uma meta sem perder o original.
3. IA relaciona quatro pensamentos e exibe as fontes corretas.
4. Dono pede análise operacional por período e abre a origem citada.
5. Dono solicita pesquisa externa e recebe fontes separadas.
6. Ritual semanal chega preparado e gera uma decisão pendente de aceite.
7. Decisão vira prévia de rotina, é editada e criada uma única vez.
8. Segundo dono, gestor e funcionário não conseguem acessar o conteúdo.
9. Provider de IA indisponível não impede escrita nem salvamento.

## 26. Entrega interna e critério de pronto

### Incremento 1 — Fundação privada

- schema e repositórios;
- autorização por dono;
- rota e navegação;
- home, editor, autosave e versões;
- uploads, transcrição e extração;
- Entrada, Tudo, coleções e busca lexical.

### Incremento 2 — Inteligência

- extensões do harness;
- copiloto com streaming;
- prompts, schemas e sugestões;
- contexto operacional e citações;
- pesquisa externa sob consentimento;
- embeddings, recuperação híbrida e relações sugeridas.

### Incremento 3 — Orquestração

- metas, decisões, planos e rituais;
- sessões e preparação de rituais;
- configurações de proatividade;
- ponte operacional com idempotência e rastreabilidade.

### Incremento 4 — Acabamento WOW

- performance e carregamento sob demanda;
- atalhos e ações por seleção;
- microinterações quiet ops;
- acessibilidade e responsividade;
- observabilidade;
- testes de segurança, integração e E2E;
- teste manual com dados reais representativos.

A primeira versão só é considerada pronta quando os quatro incrementos estiverem integrados. Incrementos são uma estratégia de construção, não autorização para lançar uma experiência parcial como concluída.

## 27. Critérios de aceite do produto

1. Um dono consegue capturar qualquer material sem escolher categoria.
2. O conteúdo continua disponível quando a IA falha.
3. O original e seu histórico permanecem recuperáveis após qualquer ação de IA.
4. A IA nunca modifica, publica ou cria algo sem confirmação.
5. Outro dono da mesma empresa não consegue descobrir nem abrir o conteúdo.
6. O Estúdio oferece escrita livre e estruturas estratégicas opcionais.
7. Metas funcionam com ou sem indicador e prazo.
8. Rituais são configuráveis, privados e podem chegar preparados.
9. Toda afirmação baseada na operação ou internet possui fonte adequada.
10. Pesquisa externa só ocorre após solicitação explícita.
11. Uma conclusão pode gerar prévia operacional e ser confirmada uma única vez.
12. A navegação, tipografia, cores, estados e movimentos parecem parte do mesmo Baase.
13. A home transmite calma e retomada, não cobrança.
14. Os seis momentos de “WOW” são demonstráveis em testes E2E e revisão manual.
15. Acessibilidade, isolamento, recuperação de falhas e responsividade passam pela suíte definida.

## 28. Evoluções posteriores

- compartilhamento explícito entre donos;
- espaços estratégicos de gestores limitados por área;
- comentários e colaboração;
- integrações externas;
- importação de acervos;
- modelos de rituais por segmento;
- pesquisa profunda com múltiplas etapas;
- relatórios estratégicos compartilháveis;
- experiência móvel nativa;
- controles corporativos adicionais de retenção e compliance.

Essas evoluções não devem introduzir acesso retroativo ao acervo privado. Qualquer compartilhamento futuro precisa ser explícito, granular, revogável e auditável.

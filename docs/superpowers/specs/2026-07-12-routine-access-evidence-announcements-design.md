# Acesso de Rotinas, Evidências e Comunicados - Design

## Objetivo

Corrigir o isolamento operacional do Baase para que cada pessoa veja e execute
somente o trabalho que lhe pertence, tornar evidencias anexos reais e fazer
comunicados exibirem autor e publico corretos.

O problema central e de seguranca: uma ocorrencia de rotina sem responsavel
individual esta sendo devolvida para qualquer perfil. Uma pessoa de Financeiro,
por exemplo, consegue ver tarefas de uma rotina Tecnica. A interface nao pode
ser a unica barreira; o filtro deve acontecer na API antes da resposta.

## Escopo

1. Geracao, reconciliacao e leitura de ocorrencias de rotina.
2. Autoria e segmentacao de comunicados.
3. Upload e validacao de evidencias de tarefas.

Nao inclui notificacoes, novos papeis, redesign da navegacao ou migracao de
dados historicos alem das ocorrencias pendentes do dia afetado.

## Rotinas e tarefas de hoje

### Regra de atribuicao

- O criador de uma rotina e apenas o autor do cadastro. Ele nao se torna
  responsavel por ela automaticamente.
- Quando uma rotina possui responsaveis e modo de execucao `individual`, o
  sistema gera uma ocorrencia independente da rotina para cada responsavel.
- Cada ocorrencia individual tem checklist, evidencia, status, prazo e
  conclusao proprios. Peterson concluir uma ocorrencia nao conclui a de Andre.
- Uma rotina compartilhada continua possivel, mas so pode ser lida por quem
  tem acesso a area operacional da rotina. Uma tarefa sem responsavel nunca
  significa visivel para toda a empresa.
- Tarefas pontuais continuam visiveis somente ao responsavel, exceto para dono
  e gestores autorizados pela area conforme a politica existente.

### Contrato de leitura

Para uma pessoa receber uma tarefa no endpoint `Hoje`, a API deve confirmar ao
menos uma das condicoes abaixo:

1. A tarefa esta atribuida ao perfil da pessoa.
2. A tarefa e compartilhada, a pessoa tem acesso a area da tarefa e a politica
   de acesso permite leitura daquela area.
3. A pessoa e dona do workspace.

Uma pessoa com escopo `assigned_only` nao recebe tarefas sem atribuicao. Uma
pessoa de Financeiro nao recebe tarefas de uma rotina Tecnica, mesmo que a
tarefa antiga esteja sem responsavel individual.

### Reconciliacao de ocorrencias pendentes

Ao editar uma rotina, o sistema deve reconciliar as ocorrencias pendentes da
data corrente que ainda representam a versao anterior:

- criar ocorrencias para responsaveis adicionados;
- remover ou arquivar ocorrencias pendentes de responsaveis removidos;
- atualizar titulo, area, checklist, prazo, politica de evidencia e aprovacao
  nas ocorrencias pendentes preservadas;
- manter ocorrencias submetidas, aguardando aprovacao, devolvidas ou concluidas
  como registro historico imutavel.

O processo deve ser idempotente: consultar `Hoje` mais de uma vez nao duplica
tarefas.

## Comunicados

### Autor

- O autor do comunicado e `createdByProfileId`, salvo no backend no momento da
  criacao.
- A tela resolve esse perfil para nome e iniciais reais. Ela nunca usa avatar ou
  texto fixo como `MA` ou `Baase` para um comunicado criado por uma pessoa.
- Caso o perfil historico tenha sido removido, a interface mostra `Autor
  removido`, preservando o comunicado sem inventar uma identidade.

### Publico

O formulario de novo comunicado tera o mesmo padrao de publico ja utilizado
por treinamentos:

- Empresa inteira.
- Uma area.
- Um cargo.
- Uma pessoa.

O campo exigira a selecao complementar correspondente. A API continua sendo a
autoridade: gestor so pode criar ou ler conteudo no escopo de suas areas; dono
pode usar qualquer publico. A descricao no detalhe exibira o destino real, por
exemplo `Tecnico, Implantacao e Entregaveis`, e nao `uma area`.

## Evidencias de tarefas

### Modelo

- Evidencia deixa de depender de URL digitada manualmente.
- A pessoa pode anexar imagem, PDF ou documento compatvel pelo seletor nativo
  do sistema. Em celular, o seletor de imagem tambem oferece captura pela
  camera quando suportada pelo navegador.
- O arquivo e enviado ao armazenamento MinIO ja configurado para o Baase e a
  tarefa guarda nome, tipo, tamanho e chave/URL de acesso controlado.
- A tela mostra o arquivo selecionado antes do envio e o anexo registrado apos
  a conclusao.

### Validacao

- `optional`: comentario e anexo sao opcionais.
- `comment_required`: exige comentario.
- `photo_required` sera apresentado como `Evidencia obrigatoria` e aceita
  imagem, PDF ou documento. Dados antigos em `photo_url` seguem legiveis.
- `photo_or_comment_required` sera apresentado como `Comentario ou evidencia`
  e aceita pelo menos um dos dois.

O backend valida a regra depois do upload; a interface so antecipa o erro para
dar uma orientacao clara. Um URL arbitrario digitado pelo cliente nao satisfaz
mais uma politica de evidencia obrigatoria.

## Componentes e limites

- `routine.service`: gera e reconcilia ocorrencias; nao decide permissao de
  area por conta propria.
- `routine.routes` e politica de acesso: aplicam a identidade e o escopo da
  pessoa antes de devolver, executar ou editar uma tarefa.
- `announcement.service/routes`: preservam a audiencia tipada e entregam dados
  suficientes para a autoria ser resolvida no cliente.
- `evidence storage service`: concentra validacao de arquivo, escrita no MinIO
  e referencia persistida. O fluxo de tarefa o usa sem conhecer detalhes do
  bucket.
- Frontend: reutiliza os controles, modais e tipografia atuais; adiciona
  seletor de publico e seletor de arquivo sem alterar a estetica do produto.

## Erros e estados

- Sem permissao para area: `403 BAASE_SCOPE_FORBIDDEN`, sem vazar titulo ou
  metadados da tarefa.
- Tarefa de outro responsavel: `403 TASK_NOT_ASSIGNED_TO_PROFILE`.
- Evidencia ausente ou arquivo invalido: erro de validacao explicando a regra
  exigida e os formatos aceitos.
- Falha de MinIO: nenhum envio de tarefa e confirmado; o arquivo e mantido no
  seletor para nova tentativa quando o navegador permitir.
- Rotina atualizada concorrente: ocorrencia concluida nao e sobrescrita e a
  pendente e reconciliada com controle de versao.

## Testes e criterios de aceite

### API

- Um funcionario de Financeiro nao recebe, le, atualiza checklist ou conclui
  ocorrencia de rotina Tecnica.
- Peterson e Andre recebem ocorrencias diferentes da mesma rotina individual.
- O criador que nao foi selecionado nao recebe ocorrencia.
- Alterar responsaveis reconcilia somente ocorrencias pendentes e nao duplica
  tarefas em chamadas repetidas de `Hoje`.
- Comunicado para area, cargo e pessoa chega somente ao publico correspondente;
  o payload mantem o autor correto.
- Upload de imagem, PDF e documento cria evidencia; tipos/tamanhos invalidos e
  evidencia obrigatoria ausente falham de forma previsivel.

### Interface

- O detalhe de comunicado mostra nome, iniciais e publico real.
- O formulario de comunicado permite selecionar os quatro destinos e apresenta
  somente a lista complementar necessaria.
- O modal de executar tarefa permite escolher arquivo e mostra estado de envio,
  erro e sucesso sem campo de URL manual.
- Em largura de celular, os controles de anexo e captura permanecem acessiveis
  e o rodape do modal nao cobre o seletor.

### Regressao

- Suite de API, web e shared passa integralmente.
- Typecheck e build web passam.
- Fluxo manual em producao: criar rotina Tecnica para Peterson e Andre, entrar
  como funcionario de Financeiro e confirmar que ela nao aparece; depois anexar
  um PDF e concluir uma tarefa que exige evidencia.

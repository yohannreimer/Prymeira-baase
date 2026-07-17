# Funcionário: carregamento e PDF de processos

## Objetivo

Eliminar requisições administrativas indevidas durante a inicialização da conta de funcionário e permitir que um funcionário baixe o PDF de um processo que já pode consultar.

## Escopo

- A inicialização deve descobrir a sessão autenticada antes de requisitar dados opcionais dependentes de papel.
- Uma conta de funcionário pode gerar e baixar PDF somente de processo publicado que a política de área já permite ler.
- Processo sem área é global e, se publicado, pode ter PDF baixado por qualquer funcionário ativo.
- Rascunhos e processos de outras áreas continuam indisponíveis para funcionários.
- Estúdio, onboarding, convites, aprovações, visão operacional e sugestões de IA continuam exclusivos de gestão.

## Desenho

### Bootstrap da aplicação

O cliente consulta `/api/me` primeiro. O papel retornado por essa sessão determina as chamadas subsequentes. Assim, uma conta de funcionário não inicia chamadas a endpoints de gestão e não polui o console com respostas 403 esperadas.

### PDF de processo

O endpoint de publicação recebe a intenção de criar PDF de um processo. Para esse recurso, a API obtém o processo e autoriza a operação somente se:

1. o processo existe no workspace;
2. o status é `published`;
3. `canReadAreaResource` permite leitura para a associação operacional autenticada.

A publicação gerada continua pertencendo ao perfil que a solicitou; a URL temporária de download só permite o arquivo recém-gerado por esse mesmo perfil. Recursos do Estúdio preservam as regras atuais de dono/gestão.

O cliente passa o papel efetivo para a API do Estúdio também no modo local, para que a simulação de permissões reflita o perfil exibido.

## Erros e experiência

- Sem acesso ao processo, a API responde 403 sem revelar conteúdo ou materiais.
- Processo inexistente responde 404.
- Falhas de renderização mantêm a mensagem atual de tentativa posterior.
- O botão de PDF continua disponível para um processo que o usuário consegue ler; a API é a fonte de verdade para autorização.

## Verificação

- Teste de bootstrap garante que funcionário não chama endpoints administrativos.
- Testes de rota garantem que funcionário consegue criar/download de PDF de processo publicado da própria área e sem área.
- Testes de rota garantem bloqueio para rascunho e para processo de outra área.
- Testes existentes de publicação de Estúdio continuam protegendo os recursos administrativos.

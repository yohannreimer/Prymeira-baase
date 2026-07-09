# Bootstrap de primeira entrada em producao

## Objetivo

Uma pessoa autenticada que entra no Baase pela primeira vez deve ver o onboarding
da propria empresa. A aplicacao nunca pode exibir nomes, empresas ou dados de
demonstracao como fallback em producao.

## Escopo

- O Account Hub passa a fornecer, no `access-check`, o identificador e o nome
  reais do workspace, alem da identidade do cliente autenticado.
- O Baase usa esses dados no contexto autenticado e em `/me`.
- O front trata o bootstrap como uma etapa explicita: primeiro resolve sessao,
  inventario da empresa e onboarding; depois renderiza onboarding, aplicacao ou
  uma tela de recuperacao.
- Uma empresa sem areas, pessoas, processos e rotinas abre o onboarding do dono.
  Quando ainda nao existir sessao de onboarding, ela e criada automaticamente.
- Falhas em dados auxiliares, como sugestoes de IA, biblioteca ou metricas, nao
  invalidam o inventario essencial. Falhas no bootstrap essencial exibem uma
  tela de erro com nova tentativa, sem renderizar valores ficticios.
- A imagem implantada usa a tag do commit publicada pelo GitHub Actions. O
  `docker-compose.prod.yml` deixa de depender apenas de `latest` para que web e
  API sejam atualizados de forma coordenada.

## Fluxo

1. O Clerk autentica a pessoa e o Hub decide o acesso ao produto `base`.
2. O Hub retorna acesso, workspace e identidade do cliente.
3. A API do Baase transforma essa resposta em contexto autenticado, incluindo
   `workspaceId`, papel, `profileId`, nome do workspace e nome da pessoa.
4. O front busca o bootstrap essencial: sessao, areas, pessoas, processos e
   rotinas; o onboarding e buscado em paralelo para o dono.
5. Se o inventario essencial estiver vazio, o front garante uma sessao de
   onboarding e apresenta o assistente.
6. Se houver estrutura, a aplicacao abre no painel adequado ao papel.

## Dados e contratos

O `GET /access-check` do Account Hub passa a incluir opcionalmente:

- `workspace_name`
- `customer_id`
- `customer_name`

O Baase preserva esses campos somente no contexto da requisicao. O `profileId`
do Baase passa a ser derivado de `customer_id`, e nao do papel, evitando que
duas pessoas recebam o mesmo identificador interno.

`GET /me` retorna o nome real do workspace e da pessoa quando a empresa ainda
nao tiver membros cadastrados. Depois do onboarding, a pessoa cadastrada na
empresa continua tendo precedencia para a exibicao operacional.

## Resiliencia e erros

- `/health` e `/readiness` permanecem publicos em modo Account.
- Chamadas essenciais usam uma fronteira clara de erro. A interface mostra uma
  mensagem de carregamento ou recuperacao ate elas terminarem.
- Dados secundarios usam `Promise.allSettled` e assumem valores vazios quando
  indisponiveis, mantendo a empresa e o onboarding acessiveis.
- Nenhum caminho de producao usa `Marina Alves`, `Estudio Norte` ou outro dado
  de demo como valor apresentado ao usuario.

## Testes

- Account Hub: `access-check` retorna workspace e cliente para um acesso valido.
- API Baase: mapeia identidade real, gera IDs distintos por cliente e mantem
  health/readiness sem autenticacao.
- Web: workspace vazio com onboarding inexistente cria e mostra onboarding.
- Web: falha em endpoint auxiliar nao impede o primeiro acesso.
- Web: falha em endpoint essencial mostra recuperacao, sem painel com dados de
  demonstracao.
- Integracao: build das duas imagens e smoke test autenticado/nao autenticado,
  seguido de publicacao com a mesma tag de commit no Portainer.

## Fora de escopo

- Alterar regras de assinatura, assentos ou cobranca do Account Hub.
- Criar membros reais da equipe automaticamente a partir do Hub.
- Migrar registros existentes de empresas ja configuradas.

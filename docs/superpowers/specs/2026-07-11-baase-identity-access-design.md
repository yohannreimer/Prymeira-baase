# Identidade e Acesso Operacional do Baase

**Status:** aprovado para planejamento

## Objetivo

Fazer com que cada pessoa que entra no Baase tenha uma identidade operacional real, vinculada ao seu usuário Clerk e ao workspace do Account Hub. Donos, gestores e funcionários devem ver e alterar somente o que a sua função e o seu escopo permitem.

O resultado elimina a divergência atual entre `account_<customer_id>` e `person_*`: a mesma pessoa que recebe uma tarefa é a pessoa autenticada que a enxerga e a conclui.

## Decisões

- O **Prymeira Account Hub** é a fonte de verdade para autenticação Clerk, workspace, cadeira do produto `base` e convite por e-mail.
- O **Baase** é a fonte de verdade para a pessoa operacional, área principal, áreas acessíveis, cargo, papel operacional e escopo de trabalho.
- A pessoa operacional é o identificador usado por tarefas, rotinas, treinamentos, aprovações, processos e auditoria.
- Em produção, a interface não permite alternar livremente entre Dono, Gestor e Funcionário. O papel vem da associação autenticada. Donos podem usar uma prévia claramente identificada de outra visão, sem mudar as permissões reais.
- Convites por código e aceitação pública deixam de existir no modo `account`. O modo local de demonstração pode preservar o fluxo atual para testes sem Clerk.

## Referência Existente

O desenho reaproveita o padrão do Prymeira Talk:

1. o produto recebe um bearer token Clerk;
2. valida o direito ao produto no Account Hub;
3. obtém o `clerkUserId` do token;
4. mantém um perfil local único por `workspaceId + clerkUserId`;
5. chama o Hub para convidar a pessoa ao produto.

No Baase, o perfil local será a pessoa operacional já usada pelo domínio, em vez de uma segunda entidade de usuário sem ligação com tarefas.

## Modelo de Dados

### Pessoa operacional

`TeamMember` passa a representar uma pessoa vinculável a login e ganha os campos abaixo:

- `clerkUserId: string | null`: sujeito Clerk autenticado.
- `customerId: string | null`: cliente do Account Hub.
- `accessScope: "workspace" | "area" | "assigned_only"`.
- `areaAccessIds: string[]`: áreas que a pessoa pode consultar e gerir; a `areaId` existente continua sendo a área principal/cargo principal.
- `status: "pending" | "active" | "inactive" | "archived"`.

No armazenamento relacional, `people` recebe `clerk_user_id`, `customer_id`, `access_scope` e `status` compatível. A tabela `person_area_access` armazena a relação N:N entre pessoa e área, com unicidade por workspace, pessoa e área. O armazenamento JSONB preserva a mesma forma para permitir rollback durante o corte operacional.

Invariantes:

- há no máximo uma pessoa ativa para cada `workspaceId + clerkUserId`;
- um `customerId` ativo só pode estar ligado a uma pessoa no mesmo workspace;
- todo dono usa `accessScope=workspace`;
- gestor com `accessScope=area` precisa ter ao menos uma área acessível;
- funcionário em `assigned_only` não precisa de área; funcionário em `area` precisa de ao menos uma;
- IDs de pessoa existentes não mudam. Tarefas e registros históricos continuam apontando para a mesma pessoa.

### Convite operacional

O convite local passa a guardar, além dos metadados operacionais atuais:

- e-mail normalizado;
- ID e estado retornados pelo convite do Account Hub;
- áreas, papel operacional e escopo que serão aplicados quando o usuário entrar;
- `acceptedAt` e `personId` após a vinculação.

Ele não cria acesso por conta própria. Um convite local pendente só vira pessoa ativa depois que o Hub reconhece a cadeira do produto e o Baase associa o usuário autenticado ao e-mail do convite.

## Fluxo de Convite e Primeiro Acesso

1. Um dono cria uma pessoa/convite no Baase, informando nome, e-mail, papel operacional, área principal, áreas acessíveis e escopo.
2. A API, usando o bearer token do dono, chama `POST /team/members/invite` do Account Hub com `product_key=base`.
3. A API grava o convite operacional somente depois que o Hub responde. Se o Hub já conhece o e-mail, a cadeira fica ativa; se não conhece, o Hub registra o convite pendente de 30 dias.
4. A pessoa entra ou cria a conta Clerk com o mesmo e-mail. O Hub aceita a cadeira pendente e o `access-check` passa a autorizar o produto.
5. No bootstrap autenticado do Baase (`GET /me`), a API busca o perfil do próprio usuário no Hub, localiza o convite pelo e-mail e cria/ativa ou vincula a pessoa operacional com `clerkUserId` e `customerId`.
6. O bootstrap devolve a sessão com `profile.id` igual ao ID da pessoa operacional. A partir daí, tarefas atribuídas, treinamentos, comunicados e aprovações usam essa identidade.

O acesso ao produto não é suficiente para acessar dados do Baase. Depois da validação no Hub, qualquer rota operacional exige uma associação local ativa. A única exceção é o bootstrap, que pode completar a associação de um convite pendente ou do primeiro dono.

### Primeiro dono e legado

- O primeiro usuário com papel de dono autorizado pelo Hub pode criar automaticamente sua pessoa operacional caso o workspace ainda não possua um dono vinculado.
- Para pessoas existentes, o bootstrap vincula automaticamente apenas quando houver um único registro ativo com o mesmo e-mail e sem identidade externa.
- Conflitos, e-mails ausentes e duplicidades entram em uma fila de resolução do dono. Nenhuma associação é feita por nome.
- Convites legados por código não são aceitos em produção. O dono pode reenviar um convite via Hub ou vincular manualmente a pessoa existente.

## Contexto Autenticado

O contexto de request terá duas camadas:

1. **Identidade externa:** workspace, `clerkUserId`, `customerId`, nome/e-mail, token e papel de produto retornados pelo Hub.
2. **Associação operacional:** `personId`, papel operacional, área principal, áreas acessíveis e escopo.

O hook de autenticação valida o bearer token no Hub e extrai o sujeito Clerk como o Talk. O bootstrap de sessão resolve ou cria a associação local. Rotas diferentes de bootstrap usam `requireOperationalMembership`, que devolve `403 BAASE_MEMBERSHIP_REQUIRED` quando o usuário tem cadeira no produto, mas ainda não foi associado a uma pessoa operacional.

O papel operacional não é inferido do papel de produto depois do vínculo. O Hub continua com `admin` e `member` para administrar cadeiras; o Baase mantém `owner`, `manager` e `employee` para governar o trabalho. Apenas dono operacional pode criar ou revogar cadeiras via Hub.

## Política Central de Acesso

Uma política única recebe `OperationalMembership` e o recurso solicitado. Rotas e serviços chamam essa política antes de listar ou alterar dados; filtros não ficam espalhados por telas.

| Papel e escopo | Leitura | Alteração |
| --- | --- | --- |
| Dono / workspace | Todo o workspace | Toda a empresa, inclusive pessoas, convites e permissões |
| Gestor / workspace | Todo o workspace | Processos, rotinas, tarefas e aprovações; não administra cadeiras no Hub |
| Gestor / area | Conteúdo global e das áreas acessíveis | Apenas recursos das áreas acessíveis |
| Funcionário / workspace | Conteúdo operacional do workspace e suas tarefas | Apenas suas execuções; sem gestão estrutural |
| Funcionário / area | Conteúdo global e da própria área; suas tarefas | Apenas suas execuções |
| Funcionário / assigned_only | Suas tarefas, treinamentos, comunicados e processos referenciados por essas tarefas | Apenas suas execuções |

Recursos sem área são globais. Para `assigned_only`, processos só entram no resultado se estiverem referenciados por uma tarefa atribuída; a pessoa não recebe a biblioteca inteira de SOPs.

Regras adicionais:

- gestores só atribuem e editam pessoas dentro das áreas acessíveis;
- uma tarefa manual só pode ser criada para uma pessoa que o ator possa gerir;
- checklist, envio, evidência e conclusão continuam exigindo que a tarefa seja da própria pessoa;
- aprovações são filtradas às áreas do gestor, salvo acesso geral;
- treinamentos e comunicados respeitam público, área, cargo e pessoa, além da política de escopo;
- o servidor é a autoridade. Esconder botões no frontend é complemento, nunca a proteção.

## Experiência por Papel

### Dono

Abre o painel do dono com visão integral da operação, gargalos, pessoas, áreas, permissões, convites e indicadores. Pode usar a prévia de Gestor ou Funcionário para conferir a experiência, sem executar ações como aquele usuário.

### Gestor

Abre o painel do gestor já filtrado pelas áreas acessíveis. Vê execução, atrasos, aprovações e carga da sua equipe. Não vê nem administra áreas fora do seu escopo e não pode conceder cadeiras do produto.

### Funcionário

Abre em Hoje. Vê apenas o trabalho liberado pelo seu escopo, pode expandir rotinas, concluir checklists, registrar evidências e consultar os processos necessários para executar a tarefa.

O seletor visual de papel atual fica restrito ao modo local e à prévia do dono. A sessão autenticada determina a navegação inicial e os itens de menu de produção.

## Interface de Equipe

O formulário de convite/pessoa passa a usar controles claros:

- papel operacional;
- área principal;
- seletor de uma ou mais áreas acessíveis;
- seletor de escopo;
- resumo de acesso antes do envio;
- estado `enviado`, `ativo`, `pendente de vínculo`, `inativo` ou `conflito a resolver`.

O dono terá uma lista de associações pendentes para vincular uma identidade Hub a uma pessoa existente quando o e-mail não permitir associação automática. Essa ação exige confirmação e entra no log de auditoria.

## Erros e Auditoria

- Falha ao chamar o Hub não cria convite local e mostra erro recuperável.
- Falha no bootstrap não cria associação parcial; a pessoa recebe orientação para entrar com o e-mail convidado ou pedir revisão ao dono.
- O log operacional registra convite, vínculo, alteração de papel, escopo, áreas acessíveis, revogação e resolução manual, com ator e valores anteriores/posteriores.
- As respostas diferenciam `PRODUCT_ACCESS_DENIED`, `BAASE_MEMBERSHIP_REQUIRED`, `BAASE_MEMBERSHIP_CONFLICT` e `BAASE_SCOPE_FORBIDDEN`.

## Testes de Aceitação

1. Dono convida e-mail novo; o Hub retorna convite pendente; a pessoa só ganha acesso após autenticar com o mesmo e-mail.
2. Dono convida e-mail já existente no Hub; a cadeira ativa e a pessoa é vinculada no primeiro bootstrap.
3. Duas pessoas com o mesmo papel recebem tarefas distintas e cada uma vê somente a própria tarefa em Hoje.
4. Gestor de duas áreas vê e aprova somente as tarefas dessas áreas; gestor com acesso geral vê todas.
5. Funcionário `area` vê conteúdo global e da própria área; funcionário `assigned_only` vê apenas suas tarefas e SOPs nelas referenciados.
6. Usuário com cadeira ativa, mas sem associação Baase, não acessa rotas operacionais além do bootstrap.
7. Pessoa antiga com e-mail único é vinculada sem alterar IDs já referenciados por tarefas; duplicidade exige resolução do dono.
8. A interface autenticada abre na visão correta e não permite trocar de papel para obter dados ou ações extras.
9. Testes de API cobrem cada decisão da matriz de acesso; testes web cobrem menus, estados de convite e ausência do seletor de papel em produção.

## Fora desta Etapa

Esta etapa não altera o corte JSONB para relacional, backup/rollback da VPS, MinIO, varredura de arquivos, observabilidade, CORS, rate limiting ou a lista/gerenciamento visual de materiais de processo. Esses itens permanecem como fases próprias de endurecimento de produção, depois que identidade e autorização estiverem corretas.

# Correção de acesso, Hoje e Painel do Dono

## Resumo

Esta correção elimina a divergência entre o papel autenticado e os dados exibidos, torna o checklist executável diretamente na tela Hoje e transforma o Painel do Dono em uma única superfície coerente. O trabalho preserva o visual Quiet Ops e corrige dados legados com uma migração automática.

## Acesso por papel

- Dono sempre possui alcance de workspace.
- Gestor sempre possui alcance das áreas explicitamente vinculadas, incluindo sua área principal.
- Funcionário sempre possui alcance `assigned_only` e só lê tarefas atribuídas diretamente a sua pessoa.
- Registros existentes com alcance inseguro são corrigidos pela migração: gestores passam para `area`; funcionários passam para `assigned_only`.
- A normalização em leitura permanece defensiva para proteger o sistema mesmo antes da persistência ser atualizada.

## Identidade da empresa

O nome informado no onboarding é a fonte principal do nome da empresa dentro do Baase. O nome recebido da conta externa é apenas fallback quando o onboarding ainda não possui empresa definida. O nome e papel da pessoa autenticada continuam no chip do canto superior direito.

## Hoje e checklist

- Funcionário vê apenas suas ocorrências e tarefas pontuais.
- Dono pode acompanhar todas as ocorrências; gestor permanece limitado à área.
- Cada ocorrência individual mantém seu próprio progresso, por exemplo `0/9`.
- Ao expandir uma ocorrência, cada item é um checkbox real. Clicar salva pela rota de checklist existente, bloqueia a repetição enquanto salva, atualiza o contador e reverte visualmente em caso de erro.
- O botão `Abrir checklist` é removido. A tela de execução permanece disponível apenas quando for necessário concluir/enviar evidência, por uma ação final com rótulo contextual.

## Painel do Dono

O painel passa a ter uma única hierarquia:

1. Saudação e ação Criar com IA.
2. Filtro de período.
3. Indicadores operacionais acionáveis.
4. Lista nominal selecionada e tendência por pessoa.
5. Itens que precisam de ação, sugestões da IA, execução por área e rotinas.

O cabeçalho `Acompanhamento operacional`, a segunda saudação e a segunda grade de métricas deixam de coexistir. O bloco de ativação dos primeiros sete dias é removido.

## Estados e erros

- A mudança de checkbox mostra estado indisponível durante a gravação.
- Falha ao salvar repõe o valor anterior e exibe aviso recuperável.
- Filtros operacionais mantêm os estados atual, vazio, carregando e erro.
- Listas vazias continuam explicando quando os dados aparecerão.

## Verificação

- Testes de política e rotas cobrem funcionário Financeiro sem acesso a tarefas Técnicas e a migração de escopos legados.
- Teste de sessão cobre preferência pelo nome do onboarding.
- Testes da aplicação cobrem checklist inline, ausência do botão antigo e painel sem headings/métricas duplicados.
- Testes completos, typecheck e build precisam passar antes do push.

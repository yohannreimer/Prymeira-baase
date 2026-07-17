# Estúdio amplo e publicações premium — Design

**Data:** 17 de julho de 2026  
**Status:** aprovado

## Objetivo

Transformar a escrita e a exportação do Estúdio em uma experiência coerente: a folha deve usar toda a largura útil quando o Copiloto estiver fechado e o PDF deve preservar fielmente sua estrutura. Em paralelo, recuperar a clareza operacional dos PDFs de processos/SOPs com uma apresentação premium e estruturada.

## Direção visual

A direção aprovada é a opção A:

- **Folha do Estúdio:** “Caderno do dono”, com leitura editorial, tipografia serena, hierarquia discreta e bastante respiro.
- **Processo/SOP:** “Operacional estruturado”, com seções localizáveis, etapas numeradas e diferenciação semântica por fundos suaves.
- **Linguagem geral:** Quiet Ops — elegante, lógica e calma, sem excesso de decoração, sombras ou microinterações.

## 1. Fidelidade da folha exportada

O PDF da folha deve ser uma representação diagramada do documento escrito no Estúdio, não uma reinterpretação do conteúdo.

### Requisitos

- Renderizar `bodyJson` como fonte principal.
- Preservar parágrafos, linhas em branco, títulos, listas ordenadas e não ordenadas, negrito, itálico e links.
- Não resumir, reorganizar, fundir parágrafos ou inventar seções.
- Usar `bodyText` apenas como fallback para documentos antigos sem JSON rico válido.
- Manter título editorial sem deixá-lo dominar a página.
- Exibir empresa, autor, data e número da página de forma discreta.
- Apresentar anexos e referências no final, em uma seção compacta e secundária.
- Sanitizar todos os valores e aceitar somente nós e marcas TipTap conhecidos.

### Comportamento legado

Folhas antigas continuam exportáveis. Quando não houver `bodyJson` utilizável, o sistema preserva quebras e listas detectáveis no `bodyText` atual.

## 2. Canvas adaptativo do editor

O Copiloto recolhido não pode reservar uma coluna vazia. A folha muda de largura de acordo com o estado real do painel.

### Copiloto fechado

- A folha ocupa toda a largura útil do painel do Estúdio.
- Menu de documento e botão “Abrir Copiloto” ficam numa faixa de utilidades no topo.
- O título aceita múltiplas linhas e não corta palavras.
- Cabeçalho, editor, materiais, pensamentos relacionados e divisórias compartilham a mesma largura externa.
- O texto mantém uma medida confortável de leitura dentro do canvas amplo; o painel pode crescer sem transformar os parágrafos em linhas excessivamente longas.

### Copiloto aberto

- O layout passa a duas colunas: folha à esquerda e Copiloto à direita.
- O editor reduz sua largura sem perder acesso aos controles nem quebrar conteúdo.
- Em telas estreitas, o Copiloto funciona como painel sobreposto/recolhível para não esmagar a folha.
- Não são necessárias animações elaboradas; a mudança deve ser imediata e estável.

## 3. PDF estruturado de processos/SOPs

O PDF deve recuperar a legibilidade do modelo anterior e refiná-la dentro da direção Quiet Ops.

### Estrutura

- Cabeçalho com empresa e tipo do documento.
- Título, resumo, área, versão e data de atualização.
- Blocos distintos para objetivo, gatilho e regra operacional.
- Etapas numeradas sequencialmente, cada uma com título, instrução e separação clara.
- Resultado esperado em bloco verde suave.
- Pontos de atenção em bloco âmbar suave.
- Materiais e referências em seção própria.
- Rodapé com empresa, versão e número da página.

### Regras de paginação

- Evitar separar o título da etapa de seu conteúdo imediato.
- Evitar blocos de resultado ou atenção órfãos em outra página.
- Reduzir áreas mortas sem comprimir a leitura.
- Repetir elementos de navegação somente quando úteis para documentos longos.

### Consistência estrutural

O interpretador do corpo do processo deve produzir a mesma estrutura semântica usada pela tela e pelo PDF. A numeração vem da posição real das etapas, eliminando o erro em que todas aparecem como etapa 1.

## 4. Arquitetura e segurança

- Criar um renderizador de TipTap JSON específico para publicação, com allowlist de nós e marcas.
- Extrair o interpretador de SOP para um módulo compartilhável pelo frontend e pelo backend, sem duplicar regras de parsing.
- Manter os templates de folha e SOP separados; compartilhar apenas primitivas editoriais e utilitários seguros.
- Não aceitar HTML arbitrário armazenado no documento.
- Preservar os fallbacks atuais para registros legados.

## 5. Validação

### Testes automatizados

- Folha: parágrafos, linha vazia, listas, negrito, itálico, links e fallback de texto.
- SOP: objetivo, gatilho, regra, múltiplas etapas, sequência numérica, resultado esperado, pontos de atenção e materiais.
- Editor: Copiloto fechado, aberto e comportamento em largura reduzida.
- Regressão: documentos antigos e processos com conteúdo parcial continuam exportáveis.

### Verificação visual

- Gerar PDFs reais de folha e processo.
- Renderizar todas as páginas como imagens.
- Inspecionar hierarquia, quebra de página, espaços mortos, listas, continuidade das etapas e rodapés.
- Conferir o editor em desktop com Copiloto aberto/fechado e em viewport menor.

## Fora do escopo

- Novas ferramentas de formatação no editor.
- Animações complexas.
- Reescrita automática do conteúdo exportado.
- Novos formatos além dos PDFs e pacotes já existentes.
- Reformulação geral do design system do aplicativo.

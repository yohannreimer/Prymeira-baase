# QA — compartilhamento e publicações editoriais do Estúdio

Data: 17/07/2026

## Cobertura executada

- `pnpm typecheck`: aprovado.
- `pnpm build`: aprovado; o fluxo real de processos não inclui mais os chunks do PDFMake antigo.
- API Vitest: 993 testes aprovados, 135 testes condicionais ignorados.
- Web Vitest: 546 testes aprovados.
- Playwright `owner-studio.spec.ts`: 17 cenários aprovados.
- Renderização real com Google Chrome/Playwright: folha do Estúdio e SOP gerados em A4.
- Inspeção visual: hierarquia, caracteres portugueses, título longo e rodapé sem sobreposição.
- ZIP: assinatura, PDF principal e nomes de entrada conferidos em teste automatizado.

## Correção encontrada durante a inspeção

O primeiro smoke revelou que o rodapé posicionado fora da área impressa criava uma segunda página vazia. O rodapé foi reposicionado dentro da margem e os dois fixtures curtos passaram de duas para uma página.

## Ambiente de container

O Dockerfile recebeu Chromium e fontes Noto, e os testes de configuração do compose passaram. O build local da imagem não pôde ser concluído porque o Docker Desktop retornou erro de I/O no banco interno `containerd` antes de executar qualquer etapa do Dockerfile. A falha é da instalação local do Docker, não do build da aplicação.

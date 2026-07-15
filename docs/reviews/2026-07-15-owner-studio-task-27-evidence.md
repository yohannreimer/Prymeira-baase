# Evidências da tarefa 27 — Estúdio do Dono

Data da revisão: 2026-07-15. Este registro torna verificáveis o orçamento de bundle e a revisão responsiva da tarefa 27. Ele separa testes automatizados de observação visual manual.

## Baseline e tamanho pós-tarefa

Os dois builds foram reconstruídos em worktrees limpos, com o mesmo lockfile e Vite 7.3.6:

- baseline: `3279720` (`c8057a3^`);
- pós-tarefa 27: `c8057a3`.

| Artefato | Baseline | Pós-tarefa 27 | Variação |
| --- | ---: | ---: | ---: |
| JS inicial `index` | 570,60 kB / 160,25 kB gzip | 570,60 kB / 160,25 kB gzip | 0,00 kB / 0,00 kB gzip |
| CSS inicial `index` | 79,32 kB / 14,39 kB gzip | 79,49 kB / 14,49 kB gzip | +0,17 kB / +0,10 kB gzip |
| JS lazy do Estúdio, soma dos chunks | 539,26 kB / 167,37 kB gzip | 541,11 kB / 168,83 kB gzip | +1,85 kB / +1,46 kB gzip |
| CSS lazy do Estúdio | 55,19 kB / 8,58 kB gzip | 56,46 kB / 8,66 kB gzip | +1,27 kB / +0,08 kB gzip |

O JS inicial não cresceu. Editor e copiloto continuam fora do chunk inicial; o pós-tarefa separou `StudioCopilot` em chunk próprio. O crescimento gzip somado dos chunks JS lazy do Estúdio foi de aproximadamente 0,87% e não afeta rotas que não abrem o Estúdio.

## Verificação responsiva automatizada

`tests/e2e/owner-studio-responsive.spec.ts` executa Chromium real em 1440×1000, 1024×900, 768×900 e 390×844 CSS pixels. Em cada largura, o teste verifica:

- ausência de overflow horizontal na página;
- dez destinos da navegação interna, ativação e foco por teclado até `Privacidade`;
- superfície de escrita com pelo menos 300 px de largura útil;
- navegação horizontal realmente rolável em 390 px;
- alvos mínimos de 44×44 px nas larguras de toque;
- sidecar do copiloto em 1440 px;
- sheet modal do copiloto em 1024, 768 e 390 px;
- foco inicial no campo do sheet, bloqueio do scroll do body, fechamento por `Escape`, retorno do foco ao gatilho e desbloqueio do body.

O breakpoint do copiloto passou a considerar a largura útil que sobra depois da sidebar global e da navegação do Estúdio: até 1200 px ele usa sheet; acima disso usa sidecar. A sidebar global não foi alterada.

## Revisão visual manual

O próprio teste gerou screenshots full-page em `/tmp/baase-task27-visual-review/studio-{1440,1024,768,390}.png`. Elas foram abertas e inspecionadas manualmente em 2026-07-15. Os binários temporários não são versionados para não aumentar o repositório; as observações abaixo são o registro durável:

| Largura | Observação |
| --- | --- |
| 1440 px | Navegação, editor, memória e sidecar permanecem separados, alinhados e legíveis; nenhum corte lateral foi observado. |
| 1024 px | A primeira captura revelou o sidecar comprimindo o editor até quebrar o texto quase palavra por palavra. Após o ajuste, o copiloto aparece como sheet central e a escrita preserva largura útil atrás dele. |
| 768 px | Sidebar global recolhida, sheet centralizado, campo e ações inteiros; o fundo permanece reconhecível e sem deslocamento horizontal. |
| 390 px | Sheet ocupa a largura disponível sem corte, campo, opções e CTA permanecem visíveis; navegação interna continua rolável e acionável depois do fechamento. |

Esta inspeção visual cobre o Estúdio nos quatro viewports. Não é apresentada como substituta de uma auditoria visual das demais telas do produto.

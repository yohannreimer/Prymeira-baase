# Operação do Estúdio do Dono

Este runbook cobre implantação, observabilidade, manutenção, privacidade e recuperação do Estúdio. O Estúdio é uma área privada do dono: conteúdo, versões, anexos, memória, conversas, rituais e sugestões pertencem ao par `(workspace_id, owner_profile_id)`. Gestores e funcionários não recebem acesso e a perda do papel de dono revoga o acesso imediatamente; não há transferência automática de conteúdo.

## 1. Pré-requisitos e configuração

Produção exige Postgres durável, autenticação de conta, storage S3 compatível, provider estruturado real e capacidade vetorial. As variáveis relevantes são:

| Variável | Obrigatória | Finalidade |
| --- | --- | --- |
| `BAASE_STUDIO_ENABLED=true` | sim | habilita o Estúdio após os demais checks |
| `DATABASE_URL` | sim | documentos, versões, jobs, rituais, sugestões e auditoria |
| `BAASE_STUDIO_VECTOR_ENABLED=true` | sim | declara que a infraestrutura vetorial foi preparada |
| `OPENAI_API_KEY` | sim | sugestões, sínteses, preparação e embeddings |
| `DEEPGRAM_API_KEY` | para áudio real | transcrição; sem ela o runtime anuncia provider mock |
| `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | sim | originais privados, exports e anexos |
| `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE` | conforme provider | endpoint/compatibilidade S3 |
| `BAASE_RUNTIME_MODE=production` | sim | valida configuração de produção |
| `BAASE_AUTH_MODE=account` e `PRYMEIRA_ACCOUNT_API_URL` | sim | valida papel e vínculo ativo do dono |
| `BAASE_OPERATIONAL_STORE=relational` | recomendado | contexto operacional e recursos publicados |

`S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY` também são aceitas. Não habilite a flag do Estúdio antes de concluir migração, storage e worker.

### Readiness

1. Execute `GET /health` para liveness.
2. Execute `GET /readiness` e exija `ok: true`.
3. Confirme no payload: persistência `postgres`, provider estruturado `openai`, transcrição esperada, storage `s3`, Estúdio habilitado e ausência de warnings.
4. Faça um smoke privado com um dono canário: salvar texto, recarregar, anexar arquivo, gerar sugestão e consultar conexões.
5. Confirme que gestor e funcionário recebem `403` nas rotas `/studio/*` e não veem a navegação.

Não considere um container pronto somente porque o processo iniciou. Warnings de Postgres, vetor, provider, auth ou storage bloqueiam rollout do Estúdio.

## 2. Migração e rollback

### Migração

1. Tire backup consistente do Postgres e valide restauração em ambiente isolado.
2. Garanta Postgres 16 ou versão homologada e a capacidade vetorial usada pelo ambiente.
3. Com a aplicação ainda sem tráfego do Estúdio, execute:

   ```sh
   pnpm --filter @prymeira/baase-api db:migrate-operational
   ```

4. Rode o teste de schema contra banco descartável:

   ```sh
   TEST_DATABASE_URL=postgres://... pnpm --filter @prymeira/baase-api test:postgres-schema
   ```

5. Valide tabelas/índices de `studio_documents` até `studio_portability_*`, constraints por dono, filas sem leases órfãs e extensão/capacidade vetorial.
6. Configure o worker de manutenção e execute uma passada manual.
7. Habilite `BAASE_STUDIO_ENABLED=true` somente para o canário; amplie em etapas.

As migrações são aditivas e idempotentes. O rollback seguro é funcional, não destrutivo:

1. desligue `BAASE_STUDIO_ENABLED`;
2. interrompa novas capturas e aguarde requisições em voo;
3. mantenha o worker até drenar uploads/remoções já confirmados;
4. preserve tabelas e objetos para reativação ou exportação;
5. reverta o binário apenas para uma versão compatível com o schema já expandido.

Nunca derrube tabelas ou apague objetos como rollback automático. Um rollback destrutivo exige backup verificado, export/consentimento aplicável e procedimento de retenção aprovado.

## 3. Worker de manutenção

Uma execução drena, nesta ordem, processamento de assets, exclusões de storage, uploads atômicos abandonados, indexação/memória, exports/expirações/exclusões privadas e preparação de sinais/rituais. O comando é:

```sh
pnpm --filter @prymeira/baase-api studio:maintenance
```

Agende em um scheduler com `DATABASE_URL` e as mesmas credenciais de storage/providers da API. O comando é concorrente-safe por claims/leases, mas não sobreponha execuções deliberadamente: programe a próxima somente depois do término ou use exclusão mútua no scheduler. Exit code diferente de zero indica falha de infraestrutura; falhas por item são registradas e reprogramadas pelas filas.

Monitore:

- idade e volume de `studio_assets` em `pending`/`processing`/`failed`;
- `studio_asset_upload_intents` e `studio_asset_cleanup_jobs` vencidos;
- `studio_index_jobs` aguardando, tentativas e último código de erro;
- sinais/rituais com lease vencida ou repetição de falha;
- exports pendentes/expirados e `studio_portability_object_deletions` não conciliadas;
- duração da passada, itens processados e ausência de progresso.

Nunca inclua `body_text`, transcrições, prompts, respostas, nomes de arquivo privados ou payloads de sugestão nos logs. Use IDs, status, contagens, duração e códigos de erro.

## 4. Reconciliação de assets e índice

### Asset sem original ou upload abandonado

1. Localize pelo `asset_id`, `workspace_id` e `owner_profile_id` sem imprimir conteúdo.
2. Verifique `studio_assets`, intent de upload, chave do objeto e estado da sessão atômica.
3. Rode uma passada de manutenção.
4. Se o objeto existe e o registro está pendente, deixe o processor concluir; se o upload nunca foi confirmado, deixe o cleanup abortar/remover.
5. Não marque manualmente como pronto sem validar tamanho, MIME e existência no storage.

### Texto salvo sem aparecer em conexões

1. Confirme que a versão atual existe e que há `studio_index_jobs` para ela.
2. Rode o worker e observe `attempt_count`, `next_attempt_at`, lease e `last_error_code`.
3. Verifique que o modelo/dimensão configurados correspondem ao índice.
4. Reenfileire somente a versão atual; jobs antigos devem ser superseded e chunks antigos removidos.
5. Uma falha vetorial não pode bloquear leitura ou escrita: pesquisa textual continua como fallback.

### Exclusão/arquivamento

Arquivar remove o documento das superfícies ativas, preservando histórico. Exclusão privada deve usar o fluxo de portabilidade, que remove linhas, memória e objetos e marca origens operacionais como apagadas sem excluir o recurso operacional já publicado.

## 5. IA, auditoria e custo

Execuções do Estúdio usam `source=owner_studio` em `AiRun`. Para auditoria, consulte status, task/agent/prompt/model, timestamps, provider, erro e `cost_estimate_cents`. Os campos de conteúdo são deliberadamente opacos:

```txt
input_summary  = [private owner studio input]
output_summary = [private owner studio output]
```

Não substitua esses marcadores por conteúdo real em dashboards ou logs. `cost_estimate_cents` pode permanecer nulo quando o provider não devolve uso; trate-o como estimativa, nunca como fatura. Investigue custos por quantidade de runs, modelo, duração, status e dono técnico anonimizado, sem inspecionar pensamento privado.

Alertas mínimos:

- taxa de falha/timeout por task kind;
- repetição de erro de schema do provider;
- crescimento de tokens/custo estimado por workspace;
- backlog de transcrição, embeddings e preparação;
- circuit breaker/provider indisponível.

Escrita, autosave, histórico e leitura precisam continuar funcionando durante indisponibilidade de IA.

## 6. Exportação e exclusão

### Exportar

O dono solicita `POST /studio/export`. A resposta `202` cria um export assíncrono; o worker monta o arquivo privado e `GET /studio/export/:exportId` fornece URL curta quando estiver pronto. O pacote deve conter registros legíveis e originais autorizados, sempre limitado ao mesmo dono. URLs expiram e o worker remove o objeto depois da expiração.

### Excluir

O dono confirma exatamente `EXCLUIR MEU ESTÚDIO` em `DELETE /studio/data`. A resposta `202` pode ser `completed` ou `reconciliation_pending`. Neste último caso, mantenha o worker até zerar objetos pendentes. Não informe conclusão enquanto a reconciliação não terminar.

A exclusão abrange documentos/versões, assets, coleções, relações/chunks/jobs, conversas/mensagens/sugestões/citações, estruturas/rituais/sessões, sinais/configurações e exports. Recursos operacionais já confirmados permanecem na operação, mas o vínculo privado é marcado como origem apagada.

### Perda de papel ou saída da empresa

Revogue o acesso imediatamente. O conteúdo continua vinculado ao perfil original para retenção/exportação/exclusão autorizada. Não entregue os pensamentos a outro dono, gestor ou administrador e não faça transferência silenciosa. Qualquer futura transferência exige produto, consentimento, trilha de auditoria e política próprios.

## 7. Rollout e resposta a incidente

Ordem recomendada:

1. ambiente interno com dados sintéticos;
2. dono canário, texto apenas;
3. áudio/assets e manutenção;
4. memória, IA e rituais;
5. publicação operacional com preview/confirmação;
6. grupo piloto e expansão gradual.

Critérios para avançar: readiness limpo, E2E Chromium verde, schema Postgres verde, backlog estável, nenhum vazamento entre donos/papéis e export/exclusão ensaiados.

Em incidente de privacidade, revogue a flag/acesso primeiro, preserve evidências sem copiar conteúdo para logs, identifique escopo por IDs e acione o processo de segurança. Em falha de provider, mantenha Estúdio de escrita disponível e desabilite somente ações de IA. Em falha de storage, bloqueie novos anexos, preserve texto e deixe a reconciliação retentar. Em rollback, siga o procedimento não destrutivo da seção 2.

## 8. Gate de release

Antes da produção execute, em ambiente limpo:

```sh
pnpm test
pnpm typecheck
pnpm build
TEST_DATABASE_URL=postgres://... pnpm --filter @prymeira/baase-api test:postgres-schema
pnpm exec playwright test tests/e2e/owner-studio.spec.ts --project=chromium
```

Os nove cenários obrigatórios cobrem: áudio resiliente; organização por IA com original preservado; pensamentos relacionados; contexto operacional com período e citação navegável; pesquisa externa explícita por turno; ritual preparado; criação operacional idempotente; isolamento entre donos/papéis; e escrita durante outage do provider.

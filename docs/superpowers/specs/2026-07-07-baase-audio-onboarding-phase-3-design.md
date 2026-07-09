# Baase Audio Onboarding Phase 3 Design

## Goal

Fase 3 conecta audio real ao onboarding inteligente: o dono pode gravar respostas abertas no navegador, a API transcreve com o runtime de IA/Deepgram Nova 3, e o texto transcrito alimenta a sugestao inicial da empresa.

## Scope

- Gravar audio por pergunta do onboarding usando `MediaRecorder`.
- Enviar audio curto como `audio_base64` em JSON para `POST /ai/transcriptions`.
- Manter `audio_url` suportado para storage futuro.
- Preencher a resposta da pergunta com a transcricao retornada.
- Usar fallback amigavel quando o navegador nao suporta microfone/gravacao.

Fora do V1 desta fase:

- Upload assinado para R2/S3.
- Biblioteca persistente de capturas de audio.
- Edicao por palavra ou diarizacao visual.
- Transcricao em streaming.

## Architecture

### Backend

`POST /ai/transcriptions` passa a aceitar uma de duas entradas:

- `audio_url`: fluxo existente para audio ja hospedado.
- `audio_base64` + `mime_type`: fluxo novo para gravacao direta do navegador.

A rota valida tamanho e MIME basico, decodifica base64 em `Buffer`, e chama `harness.transcribeAudio` com `audioBuffer`. O harness continua criando `ai_run` com `model: "nova-3"`, `taskKind: "transcript_cleanup"` e `source` informado.

### Web API

O client adiciona `transcribeAudioBlob(role, input)`. Ele converte `Blob` para base64 no browser e chama `/api/ai/transcriptions` com:

```json
{
  "source": "onboarding",
  "audio_base64": "...",
  "mime_type": "audio/webm",
  "language": "pt-BR",
  "keyterms": ["Prymeira Baase", "processos", "rotinas", "treinamentos"]
}
```

### React

Cada `QuestionField` em modo audio recebe uma acao `transcribeRecording(question, blob)`. O componente controla somente a experiencia local de gravar/parar; o App controla o envio para a API e atualiza `obAnswers[question]` com a transcricao.

Estados por pergunta:

- `idle`: pronto para gravar.
- `recording`: capturando audio.
- `transcribing`: aguardando Deepgram/mock.
- `ready`: resposta capturada.
- `error`: falha de permissao, suporte ou transcricao.

## Error Handling

- Se `navigator.mediaDevices.getUserMedia` ou `MediaRecorder` nao existir, a UI mostra erro curto e o usuario pode alternar para texto.
- Se a API retornar erro, a resposta anterior nao e apagada.
- Se o audio estiver vazio, a transcricao nao e enviada.
- Backend rejeita payload sem `audio_url` e sem `audio_base64`.

## Testing

- API route test: `audio_base64` vira buffer e transcricao retorna texto.
- Web API test: `Blob` vira base64 e payload usa `audio_base64`.
- App test: mock de `MediaRecorder` grava, para, chama transcricao e preenche a resposta antes de gerar sugestao.


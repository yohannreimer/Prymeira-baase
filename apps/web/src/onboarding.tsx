import { useState } from "react";
import { formatProcessSopBody } from "@prymeira/baase-shared";
import type { OnboardingAnswer, OnboardingSession, SaveOnboardingReviewDecisionInput } from "./api";

export const onboardingSegments = [
  "Agência de marketing",
  "Serviços locais",
  "Clínica",
  "Restaurante",
  "Loja / varejo",
  "E-commerce",
  "Consultoria",
  "Outro"
];

export const teamSizeRanges = [
  { id: "solo", label: "Só eu" },
  { id: "2-5", label: "2 a 5 pessoas" },
  { id: "6-15", label: "6 a 15 pessoas" },
  { id: "16-40", label: "16 a 40 pessoas" },
  { id: "40+", label: "Mais de 40 pessoas" }
];

export const onboardingGoals = [
  { id: "extract_owner_knowledge", label: "Tirar processos da minha cabeça" },
  { id: "organize_team", label: "Organizar a equipe" },
  { id: "reduce_delays", label: "Reduzir atrasos e esquecimentos" },
  { id: "train_team", label: "Treinar funcionários melhor" },
  { id: "control_operation", label: "Ter mais controle da operação" },
  { id: "scale_company", label: "Preparar a empresa para escalar" },
  { id: "improve_approvals", label: "Melhorar aprovações e qualidade" },
  { id: "reduce_whatsapp_dependency", label: "Parar de depender do WhatsApp para cobrar tarefas" }
];

export const onboardingConversationQuestions = [
  {
    id: "operations_overview",
    theme: "business_model",
    label: "O que sua empresa vende, para quem vende e como normalmente acontece a entrega?"
  },
  {
    id: "people_responsibilities",
    theme: "team_structure",
    label: "Quem faz parte da equipe hoje e o que cada pessoa costuma cuidar?"
  },
  {
    id: "bottlenecks_standards",
    theme: "operational_bottlenecks",
    label: "O que mais atrasa, se perde, depende de você ou precisa virar padrão para a equipe executar melhor?"
  }
];

const reviewSteps = [
  { id: "map", label: "Mapa da empresa" },
  { id: "people", label: "Pessoas e cargos" },
  { id: "processes", label: "Processos sugeridos" },
  { id: "routines", label: "Rotinas sugeridas" },
  { id: "trainings", label: "Treinamentos sugeridos" },
  { id: "activation", label: "Convites e ativação" }
] as const;

export type OnboardingDraftState = {
  currentStep: string;
  companyName: string;
  segment: string;
  customSegment: string;
  teamSizeRange: string;
  goals: string[];
  answers: OnboardingAnswer[];
};

type FollowupInput = {
  questionId: string;
  question: string;
  answer: string;
  inputMode: "text" | "audio";
};

type ConversationAudioState = {
  status: "idle" | "recording" | "transcribing" | "ready" | "error";
  message?: string;
};

export function createEmptyOnboardingDraft(session?: OnboardingSession | null): OnboardingDraftState {
  return {
    currentStep: session?.currentStep ?? "identity",
    companyName: session?.companyName ?? "",
    segment: session?.segment ?? "Agência de marketing",
    customSegment: session?.customSegment ?? "",
    teamSizeRange: session?.teamSizeRange ?? "",
    goals: session?.goals ?? [],
    answers: session?.mainAnswers ?? []
  };
}

export function OnboardingShell({
  session,
  draft,
  onPatch,
  onSkip,
  onGenerateDiagnosis,
  onSaveFollowup,
  onGenerateSetup,
  onSaveDecision,
  onComplete,
  onGoPanel,
  conversationAudioStates,
  onToggleConversationRecording,
  actionBusy,
  actionError
}: {
  session: OnboardingSession | null;
  draft: OnboardingDraftState;
  onPatch: (patch: Partial<OnboardingDraftState> & { currentStep?: string }) => void;
  onSkip: () => void;
  onGenerateDiagnosis: () => void;
  onSaveFollowup: (input: FollowupInput) => void;
  onGenerateSetup: () => void;
  onSaveDecision: (input: SaveOnboardingReviewDecisionInput) => void;
  onComplete: () => void;
  onGoPanel: () => void;
  conversationAudioStates: Record<string, ConversationAudioState>;
  onToggleConversationRecording: (questionId: string) => void;
  actionBusy: boolean;
  actionError: string | null;
}) {
  const currentStep = session?.currentStep === "completed"
    || session?.currentStep === "review_map"
    || session?.currentStep === "diagnosis"
    || session?.currentStep === "followup"
    || session?.currentStep === "generating_diagnosis"
    || session?.currentStep === "generating_setup"
    ? session.currentStep
    : draft.currentStep;
  const stepIndex = currentStep === "identity"
    ? 0
    : currentStep === "conversation"
      ? 1
      : currentStep === "diagnosis" || currentStep === "followup" || currentStep === "generating_diagnosis"
        ? 2
        : 3;

  return (
    <main className="onboarding-shell" aria-label="Onboarding Inteligente">
      <OnboardingHero />
      <section className="onboarding-panel">
        <ProgressDots stepIndex={stepIndex} />
        {currentStep === "conversation" ? (
          <ConversationStep
            draft={draft}
            onPatch={onPatch}
            onGenerateDiagnosis={onGenerateDiagnosis}
            audioStates={conversationAudioStates}
            onToggleRecording={onToggleConversationRecording}
            actionBusy={actionBusy}
            actionError={actionError}
          />
        ) : currentStep === "diagnosis" || currentStep === "followup" ? (
          <DiagnosisStep session={session} onSaveFollowup={onSaveFollowup} onGenerateSetup={onGenerateSetup} actionBusy={actionBusy} actionError={actionError} />
        ) : currentStep === "generating_diagnosis" ? (
          <GenerationStep
            title="Entendendo sua empresa"
            description="Estou lendo suas respostas e organizando os primeiros sinais sobre operação, equipe, gargalos e padrões."
            items={[
              "Identificando modelo de negócio e entrega",
              "Separando áreas, pessoas e responsabilidades",
              "Localizando gargalos que precisam virar padrão",
              "Preparando perguntas essenciais de follow-up"
            ]}
          />
        ) : currentStep === "generating_setup" ? (
          <GenerationStep
            title="Construindo sua primeira base"
            description="Estamos transformando diagnóstico e respostas em áreas, cargos, processos, rotinas, treinamentos e comunicado inicial."
            items={[
              "Organizando mapa da empresa",
              "Escrevendo processos iniciais",
              "Montando rotinas executáveis",
              "Preparando treinamentos curtos"
            ]}
          />
        ) : currentStep === "completed" ? (
          <CompanyReadyStep session={session} onGoPanel={onGoPanel} />
        ) : currentStep === "review_map" ? (
          <ReviewWizard session={session} onSaveDecision={onSaveDecision} onComplete={onComplete} actionBusy={actionBusy} />
        ) : (
          <IdentityStep session={session} draft={draft} onPatch={onPatch} onSkip={onSkip} />
        )}
      </section>
    </main>
  );
}

function OnboardingHero() {
  return (
    <section className="onboarding-hero">
      <div className="onboarding-brand">
        <span>b</span>
        <small>Prymeira Baase</small>
      </div>
      <div className="onboarding-hero-copy">
        <p className="mono">Configuração inicial</p>
        <h1>Vamos montar a primeira versão operacional da sua empresa.</h1>
        <p>Responda com calma. A IA transforma suas respostas em mapa, processos, rotinas e treinamentos revisáveis.</p>
      </div>
      <div className="onboarding-hero-rail" aria-hidden="true">
        <span>Mapa</span>
        <i />
        <span>Processos</span>
        <i />
        <span>Rotinas</span>
        <i />
        <span>Treinos</span>
      </div>
    </section>
  );
}

function ProgressDots({ stepIndex }: { stepIndex: number }) {
  return (
    <div className="onboarding-progress" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => <span className={index <= stepIndex ? "active" : ""} key={index} />)}
    </div>
  );
}

function IdentityStep({
  session,
  draft,
  onPatch,
  onSkip
}: {
  session: OnboardingSession | null;
  draft: OnboardingDraftState;
  onPatch: (patch: Partial<OnboardingDraftState> & { currentStep?: string }) => void;
  onSkip: () => void;
}) {
  const normalizedSegment = draft.segment === "Outro" ? draft.customSegment : draft.segment;
  const canContinue = draft.companyName.trim().length > 1 && normalizedSegment.trim().length > 1 && draft.teamSizeRange.length > 0;
  const selectedGoals = draft.goals.length;

  function toggleGoal(goalId: string) {
    onPatch({
      currentStep: "identity",
      goals: draft.goals.includes(goalId)
        ? draft.goals.filter((item) => item !== goalId)
        : [...draft.goals, goalId]
    });
  }

  return (
    <>
      <header>
        <small className="mono">Passo 1 de 4</small>
        <h2>Identidade da operação</h2>
        <p>Começamos pelo básico para a IA entender o contexto certo antes de sugerir qualquer estrutura.</p>
      </header>

      <label>
        Nome da empresa
        <input
          value={draft.companyName}
          onChange={(event) => onPatch({ companyName: event.target.value, currentStep: "identity" })}
          placeholder="Ex.: Estúdio Norte"
        />
      </label>

      <div>
        <strong>Segmento</strong>
        <div className="onboarding-choice-grid">
          {onboardingSegments.map((segment) => (
            <button className={draft.segment === segment ? "active" : ""} type="button" onClick={() => onPatch({ segment, currentStep: "identity" })} key={segment}>
              {segment}
            </button>
          ))}
        </div>
      </div>

      {draft.segment === "Outro" ? (
        <label>
          Qual é o segmento?
          <input
            value={draft.customSegment}
            onChange={(event) => onPatch({ customSegment: event.target.value, currentStep: "identity" })}
            placeholder="Ex.: instalação de energia solar"
          />
        </label>
      ) : null}

      <div>
        <strong>Tamanho da equipe</strong>
        <div className="onboarding-choice-grid compact">
          {teamSizeRanges.map((range) => (
            <button className={draft.teamSizeRange === range.id ? "active" : ""} type="button" onClick={() => onPatch({ teamSizeRange: range.id, currentStep: "identity" })} key={range.id}>
              {range.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <strong>O que você quer resolver primeiro?</strong>
        <div className="onboarding-choice-grid goals">
          {onboardingGoals.map((goal) => (
            <button className={draft.goals.includes(goal.id) ? "active" : ""} type="button" onClick={() => toggleGoal(goal.id)} key={goal.id}>
              {goal.label}
            </button>
          ))}
        </div>
        <small className="onboarding-hint">{selectedGoals ? `${selectedGoals} objetivo(s) selecionado(s)` : "Você pode selecionar mais de um objetivo."}</small>
      </div>

      <footer>
        <button className="ghost-btn" type="button" onClick={onSkip}>Configurar depois</button>
        <button className="accent-solid" type="button" disabled={!canContinue} onClick={() => onPatch({ currentStep: "conversation" })}>Continuar</button>
      </footer>
      {session?.updatedAt ? <small className="onboarding-save mono">Salvo agora</small> : null}
    </>
  );
}

function ConversationStep({
  draft,
  onPatch,
  onGenerateDiagnosis,
  audioStates,
  onToggleRecording,
  actionBusy,
  actionError
}: {
  draft: OnboardingDraftState;
  onPatch: (patch: Partial<OnboardingDraftState> & { currentStep?: string }) => void;
  onGenerateDiagnosis: () => void;
  audioStates: Record<string, ConversationAudioState>;
  onToggleRecording: (questionId: string) => void;
  actionBusy: boolean;
  actionError: string | null;
}) {
  const answeredCount = onboardingConversationQuestions.filter((question) => readAnswer(draft.answers, question.id).trim().length > 0).length;
  const canGenerate = answeredCount === onboardingConversationQuestions.length;

  function updateAnswer(question: typeof onboardingConversationQuestions[number], answer: string, inputMode: "text" | "audio" = "text") {
    onPatch({
      currentStep: "conversation",
      answers: [
        ...draft.answers.filter((item) => item.questionId !== question.id),
        {
          questionId: question.id,
          theme: question.theme,
          question: question.label,
          answer,
          inputMode
        }
      ]
    });
  }

  return (
    <>
      <header>
        <small className="mono">Passo 2 de 4</small>
        <h2>Conte como a empresa funciona hoje</h2>
        <p>Escreva como se estivesse explicando para um gestor novo. Quanto mais concreto, melhor a primeira versão.</p>
      </header>
      <div className="onboarding-conversation">
        {onboardingConversationQuestions.map((question, index) => {
          const audioState = audioStates[question.id] ?? { status: "idle" };
          const isRecording = audioState.status === "recording";
          const isTranscribing = audioState.status === "transcribing";
          const textareaId = `onboarding-answer-${question.id}`;
          const questionNumber = index + 1;
          const savedAnswer = readAnswer(draft.answers, question.id);
          const statusText = audioState.status === "recording"
            ? "Gravando sua resposta"
            : audioState.status === "transcribing"
              ? "Transformando áudio em texto"
              : audioState.status === "ready"
                ? "Transcrição adicionada"
                : savedAnswer
                  ? "Resposta salva, você pode ajustar o texto"
                  : "Escreva ou dite sua resposta";

          return (
          <article className={`onboarding-question ${isRecording ? "recording" : ""}`} key={question.id}>
            <label htmlFor={textareaId}>{question.label}</label>
            <div className={`onboarding-response-box ${audioState.status}`}>
              <textarea
                id={textareaId}
                aria-label={question.label}
                value={savedAnswer}
                onChange={(event) => updateAnswer(question, event.target.value)}
                placeholder="Pode responder em tópicos, frases soltas ou com exemplos reais."
              />
              <div className="onboarding-response-bar" role="status" aria-label={`Status do áudio da pergunta ${questionNumber}`}>
                <span className={`onboarding-listen-indicator ${audioState.status}`} aria-hidden="true" />
                <small>{statusText}</small>
                <button
                  className={`onboarding-dictate-button ${audioState.status}`}
                  type="button"
                  disabled={isTranscribing}
                  aria-label={`${isRecording ? "Parar áudio" : isTranscribing ? "Transcrevendo áudio" : "Gravar áudio"}: pergunta ${questionNumber}`}
                  onClick={() => onToggleRecording(question.id)}
                >
                  <i className={`ph-fill ${isRecording ? "ph-stop" : "ph-microphone"}`} />
                  <span>{isRecording ? "Parar" : isTranscribing ? "Transcrevendo" : "Ditar"}</span>
                </button>
              </div>
            </div>
            {audioState.status === "error" && audioState.message ? <p className="audio-error">{audioState.message}</p> : null}
          </article>
        );
        })}
      </div>
      <footer>
        <button className="ghost-btn" type="button" onClick={() => onPatch({ currentStep: "identity" })}>Voltar</button>
        <button className="accent-solid" type="button" disabled={!canGenerate || actionBusy} onClick={onGenerateDiagnosis}>
          {actionBusy ? "Entendendo..." : "Entender minha empresa"}
        </button>
      </footer>
      {actionError ? <p className="onboarding-action-error" role="alert">{actionError}</p> : null}
    </>
  );
}

function DiagnosisStep({
  session,
  onSaveFollowup,
  onGenerateSetup,
  actionBusy,
  actionError
}: {
  session: OnboardingSession | null;
  onSaveFollowup: (input: FollowupInput) => void;
  onGenerateSetup: () => void;
  actionBusy: boolean;
  actionError: string | null;
}) {
  const diagnosis = session?.diagnosis;
  const followups = session?.followupQuestions ?? [];
  const answers = session?.followupAnswers ?? [];
  const answeredQuestionIds = new Set(answers.map((answer) => answer.questionId));
  const firstOpenQuestion = followups.find((question) => !answeredQuestionIds.has(question.id));
  const [draftAnswerState, setDraftAnswerState] = useState<{ questionId: string | null; answer: string }>({
    questionId: null,
    answer: ""
  });
  const answeredCount = followups.filter((question) => answeredQuestionIds.has(question.id)).length;
  const currentQuestionNumber = firstOpenQuestion ? answeredCount + 1 : followups.length;
  const followupCountText = firstOpenQuestion
    ? `Pergunta ${currentQuestionNumber} de ${followups.length}`
    : "Perguntas essenciais respondidas";
  const draftAnswer = firstOpenQuestion && draftAnswerState.questionId === firstOpenQuestion.id ? draftAnswerState.answer : "";
  const normalizedDraftAnswer = draftAnswer.trim();

  return (
    <>
      <header>
        <small className="mono">Passo 3 de 4</small>
        <h2>Entendi sua empresa</h2>
        <p>{diagnosis?.operationalSummary ?? "A IA organizou os primeiros sinais sobre operação, equipe e gargalos."}</p>
      </header>
      <div className="onboarding-diagnosis-grid">
        <div className="onboarding-diagnosis-card">
          <small className="mono">Modelo</small>
          <strong>{diagnosis?.businessModel ?? "Operação recorrente"}</strong>
          <span>{diagnosis?.deliveryModel ?? "Entrega com etapas revisáveis"}</span>
        </div>
        <div className="onboarding-diagnosis-card">
          <small className="mono">Gargalo principal</small>
          <strong>{readFirstRecordText(diagnosis?.bottlenecks, "title") ?? "Processos dependem do dono"}</strong>
          <span>{readFirstRecordText(diagnosis?.bottlenecks, "description") ?? "Vamos transformar isso em rotina executável."}</span>
        </div>
      </div>

      {firstOpenQuestion ? (
        <div className="onboarding-followup">
          <strong className="onboarding-followup-progress">{followupCountText}</strong>
          <label>
            {firstOpenQuestion.question}
            <textarea
              value={draftAnswer}
              onChange={(event) => setDraftAnswerState({ questionId: firstOpenQuestion.id, answer: event.target.value })}
              placeholder={firstOpenQuestion.reason}
            />
          </label>
          <button
            className="accent-solid"
            type="button"
            disabled={!normalizedDraftAnswer || actionBusy}
            onClick={() => onSaveFollowup({ questionId: firstOpenQuestion.id, question: firstOpenQuestion.question, answer: normalizedDraftAnswer, inputMode: "text" })}
          >
            {actionBusy ? "Salvando..." : "Responder e continuar"}
          </button>
        </div>
      ) : (
        <div className="onboarding-generation">
          <span><i className="ph-light ph-check-circle" />Perguntas essenciais respondidas</span>
          <button className="accent-solid" type="button" disabled={actionBusy} onClick={onGenerateSetup}>
            {actionBusy ? "Gerando..." : "Gerar primeira versão da empresa"}
          </button>
        </div>
      )}
      {actionError ? <p className="onboarding-action-error" role="alert">{actionError}</p> : null}
    </>
  );
}

function GenerationStep({
  title,
  description,
  items
}: {
  title: string;
  description: string;
  items: string[];
}) {
  return (
    <>
      <header>
        <small className="mono">IA em andamento</small>
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      <div className="onboarding-generation" aria-live="polite">
        {items.map((item, index) => (
          <span key={item}>
            <i className={`ph-light ${index === 0 ? "ph-spinner-gap" : "ph-check-circle"}`} />
            {item}
          </span>
        ))}
      </div>
    </>
  );
}

function ReviewWizard({
  session,
  onSaveDecision,
  onComplete,
  actionBusy
}: {
  session: OnboardingSession | null;
  onSaveDecision: (input: SaveOnboardingReviewDecisionInput) => void;
  onComplete: () => void;
  actionBusy: boolean;
}) {
  const suggestion = session?.generatedSuggestion;
  const [activeStep, setActiveStep] = useState<typeof reviewSteps[number]["id"]>("map");
  const [editingProcess, setEditingProcess] = useState<NonNullable<OnboardingSession["generatedSuggestion"]>["processes"][number] | null>(null);

  return (
    <>
      <header>
        <small className="mono">Revisão da IA</small>
        <h2>Revise sua primeira versão operacional</h2>
        <p>Nada precisa nascer perfeito. A próxima etapa é aprovar, ajustar ou remover cada sugestão antes de criar a empresa.</p>
      </header>

      <div className="review-tabs" role="tablist" aria-label="Etapas da revisão">
        {reviewSteps.map((step) => (
          <button className={activeStep === step.id ? "active" : ""} type="button" onClick={() => setActiveStep(step.id)} key={step.id}>
            {step.label}
          </button>
        ))}
      </div>

      <div className="review-wizard">
        {activeStep === "map" ? (
          <div className="onboarding-diagnosis-grid">
            <div className="onboarding-diagnosis-card">
              <small className="mono">Mapa</small>
              <strong>{suggestion?.areas.length ?? 0} áreas</strong>
              <span>{suggestion?.roles.length ?? 0} cargos sugeridos</span>
            </div>
            <div className="onboarding-diagnosis-card">
              <small className="mono">Conteúdo</small>
              <strong>{(suggestion?.processes.length ?? 0) + (suggestion?.routines.length ?? 0) + (suggestion?.trainings.length ?? 0)} itens</strong>
              <span>Processos, rotinas e treinamentos prontos para revisão.</span>
            </div>
          </div>
        ) : null}

        {activeStep === "people" ? (
          <ReviewList
            emptyText="Nenhuma pessoa sugerida."
            items={(suggestion?.people ?? []).map((person) => ({
              id: person.id,
              title: person.name,
              meta: [person.roleName, person.areaName].filter(Boolean).join(" · ") || "Pessoa sugerida",
              description: person.placeholder ? "Placeholder para o dono completar depois." : person.email ?? "Sem e-mail informado."
            }))}
          />
        ) : null}

        {activeStep === "processes" ? (
          <div className="review-list">
            {(suggestion?.processes ?? []).map((process) => (
              <article className="review-item-card" key={process.id}>
                <small className="mono">{process.areaName ?? "Sem área"}</small>
                <h3>{process.title}</h3>
                <p>{process.summary}</p>
                <span>{process.metadata.expectedImpact}</span>
                <footer>
                  <button type="button" aria-label={`Editar ${process.title}`} onClick={() => setEditingProcess(process)}>Editar {process.title}</button>
                  <button type="button" onClick={() => onSaveDecision({ itemType: "process", itemId: process.id, action: "draft", editedPayload: null })}>Manter rascunho</button>
                  <button type="button" onClick={() => onSaveDecision({ itemType: "process", itemId: process.id, action: "remove", editedPayload: null })}>Remover</button>
                </footer>
              </article>
            ))}
          </div>
        ) : null}

        {activeStep === "routines" ? (
          <ReviewList
            emptyText="Nenhuma rotina sugerida."
            items={(suggestion?.routines ?? []).map((routine) => ({
              id: routine.id,
              title: routine.title,
              meta: routine.areaName ?? "Sem área",
              description: routine.taskTitles.join(" · ")
            }))}
          />
        ) : null}

        {activeStep === "trainings" ? (
          <ReviewList
            emptyText="Nenhum treinamento sugerido."
            items={(suggestion?.trainings ?? []).map((training) => ({
              id: training.id,
              title: training.title,
              meta: "Treinamento curto",
              description: training.description
            }))}
          />
        ) : null}

        {activeStep === "activation" ? (
          <ReviewList
            emptyText="Nenhum passo de ativação sugerido."
            items={(session?.activationPlan ?? []).map((step) => ({
              id: String(step.day),
              title: `Dia ${step.day}: ${step.title}`,
              meta: "Plano de ativação",
              description: step.objective
            }))}
          />
        ) : null}
      </div>

      <footer>
        <button className="ghost-btn" type="button" onClick={() => setActiveStep("map")}>Voltar ao mapa</button>
        <button className="accent-solid" type="button" disabled={actionBusy} onClick={onComplete}>
          {actionBusy ? "Criando..." : "Criar primeira versão da empresa"}
        </button>
      </footer>

      {editingProcess ? (
        <ReviewProcessDrawer
          process={editingProcess}
          onClose={() => setEditingProcess(null)}
          onSave={(title) => {
            onSaveDecision({
              itemType: "process",
              itemId: editingProcess.id,
              action: "draft",
              editedPayload: { title }
            });
            setEditingProcess(null);
          }}
        />
      ) : null}
    </>
  );
}

function ReviewList({
  items,
  emptyText
}: {
  items: Array<{ id: string; title: string; meta: string; description: string }>;
  emptyText: string;
}) {
  if (!items.length) return <div className="review-empty">{emptyText}</div>;

  return (
    <div className="review-list">
      {items.map((item) => (
        <article className="review-item-card" key={item.id}>
          <small className="mono">{item.meta}</small>
          <h3>{item.title}</h3>
          <p>{item.description}</p>
        </article>
      ))}
    </div>
  );
}

function ReviewProcessDrawer({
  process,
  onClose,
  onSave
}: {
  process: NonNullable<OnboardingSession["generatedSuggestion"]>["processes"][number];
  onClose: () => void;
  onSave: (title: string) => void;
}) {
  const [title, setTitle] = useState(process.title);
  const processBody = process.body ?? formatProcessSopBody({
    objective: process.objective ?? process.summary,
    trigger: process.trigger ?? "Sempre que este processo for necessário.",
    operationalRule: process.operationalRule ?? null,
    steps: process.steps ?? []
  });

  return (
    <div className="review-drawer-layer" role="presentation">
      <aside className="review-drawer" role="dialog" aria-modal="true" aria-label={`Editar ${process.title}`}>
        <header>
          <div>
            <small className="mono">Processo</small>
            <h2>Editar sugestão</h2>
          </div>
          <button className="icon-btn" type="button" aria-label="Fechar edição" onClick={onClose}><i className="ph-light ph-x" /></button>
        </header>
        <label>
          Titulo do processo
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          Corpo sugerido
          <textarea value={processBody} readOnly />
        </label>
        <footer>
          <button className="secondary-btn" type="button" onClick={onClose}>Cancelar</button>
          <button className="accent-solid" type="button" disabled={!title.trim()} onClick={() => onSave(title.trim())}>Salvar decisão</button>
        </footer>
      </aside>
    </div>
  );
}

function CompanyReadyStep({ session, onGoPanel }: { session: OnboardingSession | null; onGoPanel: () => void }) {
  const summary = session?.createdSetupSummary;
  return (
    <>
      <header>
        <small className="mono">Empresa pronta</small>
        <h2>A primeira versão operacional da sua empresa está pronta.</h2>
        <p>Agora você pode revisar os primeiros rascunhos, convidar a equipe e ativar a primeira rotina no seu ritmo.</p>
      </header>
      {summary ? (
        <div className="ready-stats">
          <span><strong>{summary.areas}</strong> áreas</span>
          <span><strong>{summary.roles}</strong> cargos</span>
          <span><strong>{summary.people + summary.placeholders}</strong> pessoas</span>
          <span><strong>{summary.processes}</strong> processos</span>
          <span><strong>{summary.routines}</strong> rotinas</span>
          <span><strong>{summary.trainings}</strong> treinos</span>
        </div>
      ) : null}
      <footer className="ready-actions">
        <span>O próximo passo aparece no painel como um plano guiado de ativação.</span>
        <button className="accent-solid" type="button" onClick={onGoPanel}>Ir para o Painel</button>
      </footer>
    </>
  );
}

function readAnswer(answers: OnboardingAnswer[], questionId: string) {
  return answers.find((answer) => answer.questionId === questionId)?.answer ?? "";
}

function readFirstRecordText(items: Array<Record<string, unknown>> | undefined, key: string) {
  const value = items?.[0]?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

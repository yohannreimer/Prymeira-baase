import { ClerkProvider, SignIn, useAuth } from "@clerk/clerk-react";
import { ptBR } from "@clerk/localizations";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { configureBaaseApiAuth } from "./api";
import { readBaaseAuthConfig, type BaaseWebAuthConfig } from "./auth-config";

type AccessDecision = {
  allowed: boolean;
  product_key: string;
  reason: string;
  status: string;
  upgrade_url?: string;
};

const authConfig = readBaaseAuthConfig(import.meta.env);

export function BaaseAuthRoot({ children }: { children: ReactNode }) {
  if (authConfig.mode === "local") {
    configureBaaseApiAuth(null);
    return <>{children}</>;
  }

  if (!authConfig.clerkPublishableKey) {
    return <AuthShell title="Configuração incompleta" text="O Baase precisa da chave pública do Clerk para autenticar usuários na VPS." />;
  }

  return (
    <ClerkProvider localization={ptBR} publishableKey={authConfig.clerkPublishableKey}>
      <BaaseAccessGate config={authConfig}>{children}</BaaseAccessGate>
    </ClerkProvider>
  );
}

function BaaseAccessGate({ children, config }: { children: ReactNode; config: BaaseWebAuthConfig }) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [state, setState] = useState<"checking" | "allowed" | "denied" | "error">("checking");
  const [decision, setDecision] = useState<AccessDecision | null>(null);

  useEffect(() => {
    configureBaaseApiAuth(null);

    if (!isLoaded) return;
    if (!isSignedIn) {
      setState("checking");
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("missing_clerk_token");
        const response = await fetch(`${config.accountApiUrl}/access-check?product_key=${encodeURIComponent(config.productKey)}`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        if (!response.ok) throw new Error(`access_check_${response.status}`);
        const access = await response.json() as AccessDecision;
        if (cancelled) return;
        setDecision(access);
        if (access.allowed) {
          configureBaaseApiAuth({ getToken, accountMode: true });
          setState("allowed");
        } else {
          configureBaaseApiAuth(null);
          setState("denied");
        }
      } catch {
        if (!cancelled) {
          configureBaaseApiAuth(null);
          setState("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [config.accountApiUrl, config.productKey, getToken, isLoaded, isSignedIn]);

  if (!isLoaded) {
    return <AuthShell title="Carregando Baase" text="Conectando autenticação Prymeira." />;
  }

  if (!isSignedIn) {
    return <BaaseLogin />;
  }

  if (state === "allowed") {
    return <>{children}</>;
  }

  if (state === "denied") {
    return <AccessDenied decision={decision} config={config} />;
  }

  if (state === "error") {
    return <AuthShell title="Não foi possível validar acesso" text="Tente novamente em instantes ou volte ao Hub para conferir sua assinatura." actionHref={config.hubUrl} actionLabel="Voltar ao Hub" />;
  }

  return <AuthShell title="Validando acesso" text="Conferindo se o Baase está liberado para seu workspace." />;
}

function BaaseLogin() {
  return (
    <AuthSurface>
      <section className="baase-auth-brand">
        <span className="baase-auth-eyebrow">by Prymeira</span>
        <div className="baase-auth-mark">b</div>
        <h1>Sua empresa fora da sua cabeça.</h1>
        <p>Entre para acessar processos, rotinas, treinamentos e execução diária da equipe.</p>
        <div className="baase-auth-signals">
          <span>Processos</span>
          <span>Rotinas</span>
          <span>Equipe</span>
          <span>Execução</span>
        </div>
      </section>
      <section className="baase-auth-form">
        <div className="baase-auth-form-head">
          <span className="baase-auth-eyebrow baase-auth-eyebrow--light">Prymeira Baase</span>
          <h2>Acessar operação</h2>
        </div>
        <div className="baase-auth-clerk">
          <SignIn routing="hash" />
        </div>
      </section>
    </AuthSurface>
  );
}

function AccessDenied({ decision, config }: { decision: AccessDecision | null; config: BaaseWebAuthConfig }) {
  const href = useMemo(() => {
    const returnUrl = encodeURIComponent(window.location.href);
    const reason = decision?.reason ?? "no_entitlement";
    return decision?.upgrade_url ?? `${config.hubUrl}/acesso-negado?product_key=${encodeURIComponent(config.productKey)}&reason=${encodeURIComponent(reason)}&return_url=${returnUrl}`;
  }, [config.hubUrl, config.productKey, decision]);

  useEffect(() => {
    if (import.meta.env.MODE === "test") return;
    window.location.assign(href);
  }, [href]);

  return (
    <AuthShell
      title="Baase não liberado"
      text="Seu usuário está autenticado, mas este workspace ainda não tem acesso ao Baase."
      actionHref={href}
      actionLabel="Voltar ao Hub"
    />
  );
}

function AuthShell({ title, text, actionHref, actionLabel }: { title: string; text: string; actionHref?: string; actionLabel?: string }) {
  return (
    <AuthSurface>
      <section className="baase-auth-brand baase-auth-brand--single">
        <span className="baase-auth-eyebrow">Prymeira Baase</span>
        <div className="baase-auth-mark">b</div>
        <h1>{title}</h1>
        <p>{text}</p>
        {actionHref && actionLabel ? <a className="baase-auth-action" href={actionHref}>{actionLabel}</a> : null}
      </section>
    </AuthSurface>
  );
}

function AuthSurface({ children }: { children: ReactNode }) {
  return <main className="baase-auth-surface">{children}</main>;
}

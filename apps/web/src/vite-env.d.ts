/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BAASE_AUTH_MODE?: "local" | "account";
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  readonly VITE_PRYMEIRA_ACCOUNT_API_URL?: string;
  readonly VITE_PRYMEIRA_HUB_URL?: string;
  readonly VITE_PRYMEIRA_PRODUCT_KEY?: string;
  readonly VITE_GLITCHTIP_DSN?: string;
  readonly VITE_BAASE_ENVIRONMENT?: string;
  readonly VITE_BAASE_RELEASE?: string;
  readonly VITE_GLITCHTIP_TRACES_SAMPLE_RATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __BAASE_RUNTIME_CONFIG__?: Partial<Record<keyof ImportMetaEnv, string>>;
}

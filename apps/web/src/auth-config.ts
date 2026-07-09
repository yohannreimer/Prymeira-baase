export type BaaseWebAuthMode = "local" | "account";

export type BaaseWebAuthConfig = {
  mode: BaaseWebAuthMode;
  clerkPublishableKey: string | null;
  accountApiUrl: string;
  hubUrl: string;
  productKey: string;
};

type EnvRecord = Record<string, string | undefined>;

export function readBaaseAuthConfig(env: EnvRecord, runtimeEnv: EnvRecord = readRuntimeConfig()): BaaseWebAuthConfig {
  const mergedEnv = {
    ...env,
    ...runtimeEnv
  };
  const mode = mergedEnv.VITE_BAASE_AUTH_MODE === "account" ? "account" : "local";
  return {
    mode,
    clerkPublishableKey: normalizeOptional(mergedEnv.VITE_CLERK_PUBLISHABLE_KEY),
    accountApiUrl: normalizeUrl(mergedEnv.VITE_PRYMEIRA_ACCOUNT_API_URL, "/account-api"),
    hubUrl: normalizeUrl(mergedEnv.VITE_PRYMEIRA_HUB_URL, "https://hub.prymeiradigital.com.br"),
    productKey: normalizeOptional(mergedEnv.VITE_PRYMEIRA_PRODUCT_KEY) ?? "base"
  };
}

function readRuntimeConfig(): EnvRecord {
  if (typeof window === "undefined") return {};
  return window.__BAASE_RUNTIME_CONFIG__ ?? {};
}

function normalizeOptional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeUrl(value: string | undefined, fallback: string) {
  return (normalizeOptional(value) ?? fallback).replace(/\/$/, "");
}

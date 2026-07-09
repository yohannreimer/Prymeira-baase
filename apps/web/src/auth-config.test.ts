import { describe, expect, it } from "vitest";
import { readBaaseAuthConfig } from "./auth-config";

describe("Baase auth config", () => {
  it("keeps local mode by default for development", () => {
    expect(readBaaseAuthConfig({})).toEqual({
      mode: "local",
      clerkPublishableKey: null,
      accountApiUrl: "/account-api",
      hubUrl: "https://hub.prymeiradigital.com.br",
      productKey: "base"
    });
  });

  it("reads account mode values from Vite env", () => {
    expect(readBaaseAuthConfig({
      VITE_BAASE_AUTH_MODE: "account",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_test",
      VITE_PRYMEIRA_ACCOUNT_API_URL: "https://hub.prymeiradigital.com.br/api/",
      VITE_PRYMEIRA_HUB_URL: "https://hub.prymeiradigital.com.br/",
      VITE_PRYMEIRA_PRODUCT_KEY: "base"
    })).toEqual({
      mode: "account",
      clerkPublishableKey: "pk_test",
      accountApiUrl: "https://hub.prymeiradigital.com.br/api",
      hubUrl: "https://hub.prymeiradigital.com.br",
      productKey: "base"
    });
  });

  it("lets runtime container config override build-time Vite env", () => {
    expect(readBaaseAuthConfig({
      VITE_BAASE_AUTH_MODE: "local",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_build",
      VITE_PRYMEIRA_ACCOUNT_API_URL: "/account-api"
    }, {
      VITE_BAASE_AUTH_MODE: "account",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_runtime",
      VITE_PRYMEIRA_ACCOUNT_API_URL: "https://hub.prymeiradigital.com.br/api",
      VITE_PRYMEIRA_PRODUCT_KEY: "base"
    })).toEqual({
      mode: "account",
      clerkPublishableKey: "pk_runtime",
      accountApiUrl: "https://hub.prymeiradigital.com.br/api",
      hubUrl: "https://hub.prymeiradigital.com.br",
      productKey: "base"
    });
  });
});

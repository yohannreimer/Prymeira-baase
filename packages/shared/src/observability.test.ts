import { describe, expect, it } from "vitest";
import { normalizeObservabilityPath, sanitizeObservabilityEvent } from "./observability";

const privateValues = [
  "employee@prymeira.test",
  "employee_123",
  "workspace_private",
  "customer_private",
  "Bearer private-token",
  "session=private-cookie",
  "customer prompt",
  "private transcript",
  "private PDF",
  "sk-private-openai",
  "deepgram-private",
  "minio-private",
  "clerk-private",
  "evolution-private"
];

function sensitiveEvent() {
  return {
    event_id: "evt_1",
    timestamp: 123,
    platform: "javascript",
    level: "error",
    release: "abc123",
    environment: "production",
    user: {
      id: "employee_123",
      email: "employee@prymeira.test",
      username: "Private Employee"
    },
    request: {
      method: "post",
      url: "https://baase.prymeiradigital.com.br/api/workspaces/550e8400-e29b-41d4-a716-446655440000/documents/123?token=private#fragment",
      headers: {
        authorization: "Bearer private-token",
        cookie: "session=private-cookie"
      },
      cookies: "session=private-cookie",
      query_string: "token=private",
      data: { prompt: "customer prompt" }
    },
    extra: {
      workspace: "workspace_private",
      customer: "customer_private",
      prompt: "customer prompt",
      transcript: "private transcript",
      pdf: "private PDF",
      openai: "sk-private-openai",
      deepgram: "deepgram-private",
      minio: "minio-private",
      clerk: "clerk-private",
      evolution: "evolution-private"
    },
    breadcrumbs: [
      { category: "ui.click", message: "Private Employee clicked private document" },
      { category: "fetch", data: { body: "customer prompt" } }
    ],
    contexts: {
      browser: { name: "Chrome", version: "140", private: "customer_private" },
      os: { name: "macOS", version: "15", id: "employee_123" },
      runtime: { name: "node", version: "22.20", prompt: "customer prompt" },
      trace: { trace_id: "trace_private", span_id: "span_private", op: "http.server" },
      customer: { name: "customer_private" }
    },
    tags: {
      product: "baase",
      service: "baase-api",
      component: "http",
      runtime: "node",
      employee: "employee_123",
      workspace: "workspace_private"
    },
    transaction: "/workspaces/550e8400-e29b-41d4-a716-446655440000/documents/123?email=employee@prymeira.test",
    exception: {
      values: [{
        type: "TypeError",
        value: "renderer failed",
        stacktrace: { frames: [{ filename: "src/render.ts", lineno: 42 }] },
        mechanism: { data: { body: "private PDF" } }
      }]
    },
    spans: [{
      op: "http.client",
      description: "GET https://api.example.test/workspaces/01JARZ3NDEKTSV4RRFFQ69G5FAV?token=private",
      start_timestamp: 1,
      timestamp: 2,
      status: "ok",
      data: { authorization: "Bearer private-token", prompt: "customer prompt" }
    }],
    attachments: [{ filename: "private.pdf", data: "private PDF" }]
  };
}

describe("observability privacy sanitizer", () => {
  it("preserves technical diagnosis while removing identity and business content", () => {
    const input = sensitiveEvent();
    const original = structuredClone(input);
    const sanitized = sanitizeObservabilityEvent(input);
    const serialized = JSON.stringify(sanitized);

    expect(input).toEqual(original);
    expect(sanitized).toMatchObject({
      event_id: "evt_1",
      platform: "javascript",
      release: "abc123",
      environment: "production",
      tags: {
        product: "baase",
        service: "baase-api",
        component: "http",
        runtime: "node"
      }
    });
    expect(sanitized).not.toHaveProperty("user");
    expect(sanitized).not.toHaveProperty("extra");
    expect(sanitized).not.toHaveProperty("breadcrumbs");
    expect(sanitized).not.toHaveProperty("attachments");
    expect(sanitized.request).toEqual({
      method: "POST",
      url: "https://baase.prymeiradigital.com.br/api/workspaces/:id/documents/:id"
    });
    expect(sanitized.transaction).toBe("/workspaces/:id/documents/:id");
    expect(sanitized.exception).toEqual({
      values: [{
        type: "TypeError",
        value: "renderer failed",
        stacktrace: { frames: [{ filename: "src/render.ts", lineno: 42 }] }
      }]
    });
    expect(sanitized.spans).toEqual([{
      op: "http.client",
      description: "GET https://api.example.test/workspaces/:id",
      start_timestamp: 1,
      timestamp: 2,
      status: "ok"
    }]);
    for (const privateValue of privateValues) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("normalizes dynamic, opaque, numeric, and e-mail path segments", () => {
    expect(normalizeObservabilityPath(
      "/people/employee@prymeira.test/123/550e8400-e29b-41d4-a716-446655440000/01JARZ3NDEKTSV4RRFFQ69G5FAV/abcdefghijklmnopqrstuvwxyz123456?secret=yes#x"
    )).toBe("/people/:id/:id/:id/:id/:id");
  });
});

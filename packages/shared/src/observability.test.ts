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
  "evolution-private",
  "customer invoice renderer failed for Acme",
  "Customer Acme invoice 123 could not be rendered"
];

function sensitiveEvent() {
  return {
    event_id: "0123456789abcdef0123456789abcdef",
    timestamp: 123,
    platform: "javascript",
    level: "error",
    release: "0123456789abcdef0123456789abcdef01234567",
    environment: "production",
    type: "transaction",
    message: "Customer Acme invoice 123 could not be rendered",
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
      trace: {
        trace_id: "fedcba9876543210fedcba9876543210",
        span_id: "0123456789abcdef",
        parent_span_id: "fedcba9876543210",
        op: "http.server"
      },
      customer: { name: "customer_private" }
    },
    tags: {
      product: "baase",
      service: "baase-api",
      component: "http",
      runtime: "node",
      route: "/workspaces/550e8400-e29b-41d4-a716-446655440000/documents/123",
      method: "post",
      operation: "http.server",
      employee: "employee_123",
      workspace: "workspace_private"
    },
    transaction: "/workspaces/550e8400-e29b-41d4-a716-446655440000/documents/123?email=employee@prymeira.test",
    exception: {
      values: [{
        type: "TypeError",
        value: "customer invoice renderer failed for Acme",
        stacktrace: {
          frames: [{
            filename: "https://baase.prymeiradigital.com.br/assets/app.js?customer=Acme",
            abs_path: "https://baase.prymeiradigital.com.br/assets/app.js?customer=Acme",
            lineno: 42
          }]
        },
        mechanism: { data: { body: "private PDF" } }
      }]
    },
    spans: [{
      trace_id: "fedcba9876543210fedcba9876543210",
      span_id: "1234567890abcdef",
      parent_span_id: "0123456789abcdef",
      op: "http.client",
      description: "GET https://api.example.test/workspaces/01JARZ3NDEKTSV4RRFFQ69G5FAV?token=private",
      start_timestamp: 1,
      timestamp: 2,
      status: "ok",
      data: { authorization: "Bearer private-token", prompt: "customer prompt" }
    }],
    debug_meta: {
      images: [{
        type: "sourcemap",
        code_file: "https://baase.prymeiradigital.com.br/assets/app.js?customer=Acme",
        debug_id: "12345678-1234-4123-8123-123456789abc",
        private: "customer_private"
      }, {
        type: "sourcemap",
        code_file: "https://baase.prymeiradigital.com.br/assets/private.js",
        debug_id: "debug_private"
      }]
    },
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
      event_id: "0123456789abcdef0123456789abcdef",
      platform: "javascript",
      release: "0123456789abcdef0123456789abcdef01234567",
      environment: "production",
      type: "transaction",
      message: "[redacted]",
      tags: {
        product: "baase",
        service: "baase-api",
        component: "http",
        runtime: "node",
        route: "/workspaces/:id/documents/:id",
        method: "POST",
        operation: "http.server"
      },
      contexts: {
        trace: {
          trace_id: "fedcba9876543210fedcba9876543210",
          span_id: "0123456789abcdef",
          parent_span_id: "fedcba9876543210",
          op: "http.server"
        }
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
        value: "[redacted]",
        stacktrace: {
          frames: [{
            filename: "https://baase.prymeiradigital.com.br/assets/app.js",
            abs_path: "https://baase.prymeiradigital.com.br/assets/app.js",
            lineno: 42
          }]
        }
      }]
    });
    expect(sanitized.spans).toEqual([{
      trace_id: "fedcba9876543210fedcba9876543210",
      span_id: "1234567890abcdef",
      parent_span_id: "0123456789abcdef",
      op: "http.client",
      description: "GET https://api.example.test/workspaces/:id",
      start_timestamp: 1,
      timestamp: 2,
      status: "ok"
    }]);
    expect(sanitized.debug_meta).toEqual({
      images: [{
        type: "sourcemap",
        code_file: "https://baase.prymeiradigital.com.br/assets/app.js",
        debug_id: "12345678-1234-4123-8123-123456789abc"
      }]
    });
    for (const privateValue of privateValues) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("normalizes dynamic, opaque, numeric, and e-mail path segments", () => {
    expect(normalizeObservabilityPath(
      "/people/employee@prymeira.test/123/550e8400-e29b-41d4-a716-446655440000/01JARZ3NDEKTSV4RRFFQ69G5FAV/abcdefghijklmnopqrstuvwxyz123456?secret=yes#x"
    )).toBe("/people/:id/:id/:id/:id/:id");
  });

  it("drops non-protocol identifiers and unsupported debug metadata", () => {
    const sanitized = sanitizeObservabilityEvent({
      event_id: "customer_private_event_identifier",
      release: "customer-private-release",
      type: "profile",
      contexts: {
        trace: {
          trace_id: "trace_private",
          span_id: "span_private",
          parent_span_id: "parent_private",
          op: "http.server"
        }
      },
      spans: [{
        trace_id: "trace_private",
        span_id: "span_private",
        parent_span_id: "parent_private",
        op: "http.client"
      }],
      debug_meta: {
        images: [{
          type: "sourcemap",
          code_file: "https://example.test/private.js",
          debug_id: "customer_private_debug_id"
        }, {
          type: "macho",
          code_file: "/Users/Private/private-app",
          debug_id: "12345678-1234-4123-8123-123456789abc",
          image_addr: "customer_private"
        }]
      }
    });

    expect(sanitized).not.toHaveProperty("event_id");
    expect(sanitized).not.toHaveProperty("release");
    expect(sanitized).not.toHaveProperty("type");
    expect(sanitized.contexts).toEqual({ trace: { op: "http.server" } });
    expect(sanitized.spans).toEqual([{ op: "http.client" }]);
    expect(sanitized).not.toHaveProperty("debug_meta");
    expect(JSON.stringify(sanitized)).not.toContain("customer_private");
  });
});

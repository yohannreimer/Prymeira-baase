import type { LifecycleRule } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import {
  BAASE_MULTIPART_LIFECYCLE_RULE_ID,
  createBaaseMultipartLifecycleRule,
  hasSafeMultipartLifecycle
} from "./s3-lifecycle-policy";

const abortAfterOneDay = {
  DaysAfterInitiation: 1
};

describe("S3 multipart lifecycle policy", () => {
  it.each([
    ["Filter.Prefix", {
      Status: "Enabled",
      Filter: { Prefix: "workspaces/" },
      AbortIncompleteMultipartUpload: abortAfterOneDay
    }],
    ["the whole bucket", {
      Status: "Enabled",
      AbortIncompleteMultipartUpload: abortAfterOneDay
    }],
    ["Filter.And.Prefix without restrictive filters", {
      Status: "Enabled",
      Filter: { And: { Prefix: "workspaces/" } },
      AbortIncompleteMultipartUpload: abortAfterOneDay
    }],
    ["the legacy top-level Prefix", {
      Status: "Enabled",
      Prefix: "workspaces/",
      AbortIncompleteMultipartUpload: abortAfterOneDay
    }]
  ] satisfies Array<[string, LifecycleRule]>)
    ("accepts an enabled one-day rule covering workspaces/ via %s", (_label, rule) => {
      expect(hasSafeMultipartLifecycle([rule])).toBe(true);
    });

  it.each([
    ["missing Rules", undefined],
    ["empty Rules", []],
    ["Disabled status", [{
      Status: "Disabled",
      Filter: { Prefix: "workspaces/" },
      AbortIncompleteMultipartUpload: abortAfterOneDay
    }]],
    ["other/ prefix", [{
      Status: "Enabled",
      Filter: { Prefix: "other/" },
      AbortIncompleteMultipartUpload: abortAfterOneDay
    }]],
    ["two-day abort", [{
      Status: "Enabled",
      Filter: { Prefix: "workspaces/" },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 2 }
    }]],
    ["Filter.Tag", [{
      Status: "Enabled",
      Filter: { Tag: { Key: "cleanup", Value: "yes" } },
      AbortIncompleteMultipartUpload: abortAfterOneDay
    }]],
    ["Filter.ObjectSizeGreaterThan", [{
      Status: "Enabled",
      Filter: { ObjectSizeGreaterThan: 1 },
      AbortIncompleteMultipartUpload: abortAfterOneDay
    }]],
    ["Filter.ObjectSizeLessThan", [{
      Status: "Enabled",
      Filter: { ObjectSizeLessThan: 1_000_000 },
      AbortIncompleteMultipartUpload: abortAfterOneDay
    }]],
    ["Filter.And.Tags", [{
      Status: "Enabled",
      Filter: { And: { Prefix: "workspaces/", Tags: [{ Key: "cleanup", Value: "yes" }] } },
      AbortIncompleteMultipartUpload: abortAfterOneDay
    }]],
    ["Filter.And.ObjectSizeGreaterThan", [{
      Status: "Enabled",
      Filter: { And: { Prefix: "workspaces/", ObjectSizeGreaterThan: 1 } },
      AbortIncompleteMultipartUpload: abortAfterOneDay
    }]],
    ["Filter.And.ObjectSizeLessThan", [{
      Status: "Enabled",
      Filter: { And: { Prefix: "workspaces/", ObjectSizeLessThan: 1_000_000 } },
      AbortIncompleteMultipartUpload: abortAfterOneDay
    }]]
  ] satisfies Array<[string, LifecycleRule[] | undefined]>)
    ("rejects %s", (_label, rules) => {
      expect(hasSafeMultipartLifecycle(rules)).toBe(false);
    });

  it("creates the Baase one-day workspace lifecycle rule", () => {
    expect(BAASE_MULTIPART_LIFECYCLE_RULE_ID).toBe("baase-abort-incomplete-workspace-uploads");
    expect(createBaaseMultipartLifecycleRule()).toEqual({
      ID: BAASE_MULTIPART_LIFECYCLE_RULE_ID,
      Status: "Enabled",
      Filter: { Prefix: "workspaces/" },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 }
    });
  });
});

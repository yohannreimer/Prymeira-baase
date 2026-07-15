import type { LifecycleRule } from "@aws-sdk/client-s3";

export const BAASE_MULTIPART_LIFECYCLE_RULE_ID = "baase-abort-incomplete-workspace-uploads";

export function createBaaseMultipartLifecycleRule(): LifecycleRule {
  return {
    ID: BAASE_MULTIPART_LIFECYCLE_RULE_ID,
    Status: "Enabled",
    Filter: { Prefix: "workspaces/" },
    AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 }
  };
}

export function hasSafeMultipartLifecycle(rules: LifecycleRule[] | undefined): boolean {
  return rules?.some((rule) => {
    if (rule.Status !== "Enabled") return false;
    const days = rule.AbortIncompleteMultipartUpload?.DaysAfterInitiation;
    if (typeof days !== "number" || days > 1) return false;
    const prefix = unrestrictedLifecyclePrefix(rule);
    return prefix !== null && "workspaces/".startsWith(prefix);
  }) ?? false;
}

function unrestrictedLifecyclePrefix(rule: LifecycleRule): string | null {
  if (rule.Prefix !== undefined) return rule.Prefix;
  if (!rule.Filter) return "";
  if (rule.Filter.Tag !== undefined
    || rule.Filter.ObjectSizeGreaterThan !== undefined
    || rule.Filter.ObjectSizeLessThan !== undefined) return null;
  if (rule.Filter.And) {
    const and = rule.Filter.And;
    if ((and.Tags?.length ?? 0) > 0
      || and.ObjectSizeGreaterThan !== undefined
      || and.ObjectSizeLessThan !== undefined) return null;
    return and.Prefix ?? "";
  }
  return rule.Filter.Prefix ?? "";
}

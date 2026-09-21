import { createHash, randomUUID } from "node:crypto";
import { DomainError } from "@kolbe/shared";
import {
  PRODUCTION_ARTIFACT_MIME_TYPES,
  PRODUCTION_ARTIFACT_TYPES,
  PRODUCTION_CHANGE_OWNER_DOMAINS,
  PRODUCTION_CHANGE_TYPES,
  PRODUCTION_JOB_STATUSES,
  PRODUCTION_MILESTONE_STATUSES,
  PRODUCTION_RECALL_SCOPE_TYPES,
  PRODUCTION_RECALL_SEVERITIES,
  QUALITY_DEFECT_SEVERITIES,
  QUALITY_DEFECT_STATUSES,
  QUALITY_INSPECTION_STATUSES,
  QUALITY_MEASUREMENT_TYPES,
  QUALITY_RELEASE_STATUSES,
  QUALITY_REWORK_STATUSES,
  PRODUCTION_LOT_STATUSES,
  PRODUCTION_SAMPLE_REVIEW_DECISIONS,
  PRODUCTION_SAMPLE_STATUSES,
} from "@kolbe/database";

export class ProductionDomainError extends DomainError {
  constructor(code: string, message: string, status = 400) {
    super(status, code, message);
    this.name = "ProductionDomainError";
  }
}

export const JOB_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["planned", "cancelled"],
  planned: ["in_progress", "blocked", "cancelled"],
  in_progress: ["blocked", "completed"],
  blocked: ["in_progress", "cancelled"],
  completed: [],
  cancelled: [],
};

export const MILESTONE_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ["in_progress", "skipped"],
  in_progress: ["completed", "skipped"],
  completed: [],
  skipped: [],
};

export const SAMPLE_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["submitted"],
  submitted: ["under_review"],
  under_review: ["changes_requested", "rejected", "approved"],
  changes_requested: ["submitted"],
  rejected: ["submitted"],
  approved: [],
};

export const CHANGE_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["submitted", "withdrawn"],
  submitted: ["under_review", "withdrawn"],
  under_review: ["approved", "rejected", "withdrawn"],
  approved: [],
  rejected: [],
  withdrawn: [],
};

export const INSPECTION_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["in_progress", "cancelled"],
  in_progress: ["submitted", "cancelled"],
  submitted: ["accepted", "rejected", "rework_required"],
  accepted: [],
  rejected: [],
  rework_required: ["in_progress", "submitted"],
  cancelled: [],
};

export const DEFECT_TRANSITIONS: Record<string, readonly string[]> = {
  open: ["acknowledged", "rework", "accepted", "waived", "closed"],
  acknowledged: ["rework", "accepted", "waived", "closed"],
  rework: ["closed", "accepted"],
  accepted: ["closed"],
  waived: ["closed"],
  closed: [],
};

export const REWORK_TRANSITIONS: Record<string, readonly string[]> = {
  requested: ["in_progress", "cancelled"],
  in_progress: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["requested", "cancelled"],
  cancelled: [],
};

export const LOT_TRANSITIONS: Record<string, readonly string[]> = {
  open: ["in_progress", "recall_hold"],
  in_progress: ["completed", "recall_hold"],
  completed: ["released", "recall_hold"],
  released: ["recall_hold"],
  recall_hold: ["closed"],
};

export const RELEASE_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ["ready", "rejected"],
  ready: ["approved", "rejected"],
  approved: ["revoked"],
  rejected: ["pending"],
  revoked: [],
};

export const RECALL_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["pending_approval", "cancelled"],
  pending_approval: ["approved", "rejected", "cancelled"],
  approved: ["active", "cancelled"],
  active: ["contained", "closed"],
  contained: ["closed"],
  closed: [],
  rejected: ["draft"],
  cancelled: [],
};

export function assertTransition(
  machine: Record<string, readonly string[]>,
  from: string,
  to: string,
  code = "INVALID_PRODUCTION_TRANSITION",
): void {
  if (!machine[from]?.includes(to)) {
    throw new ProductionDomainError(code, `Transition ${from} -> ${to} is not allowed`, 409);
  }
}

export function assertOneOf(value: unknown, values: readonly string[], field: string): string {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new ProductionDomainError("VALIDATION_ERROR", `${field} is not an allowed value`);
  }
  return value;
}

export function requireText(value: unknown, field: string, max = 500): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > max) {
    throw new ProductionDomainError("VALIDATION_ERROR", `${field} is required and bounded`);
  }
  return value.trim();
}

export function optionalText(value: unknown, field: string, max = 500): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requireText(value, field, max);
}

export function requireSafeInteger(value: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new ProductionDomainError("INVALID_INTEGER", `${field} must be an integer between ${min} and ${max}`);
  }
  return number;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export function requestHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function id(prefix: string): string {
  return `${prefix}_${cryptoRandomUuid()}`;
}

function cryptoRandomUuid(): string {
  // Kept behind a function so all production identifiers have one normalized shape.
  return randomUUID().replaceAll("-", "");
}

export function pageInput(pageRaw: unknown, limitRaw: unknown): { page: number; limit: number; offset: number } {
  const page = pageRaw === undefined || pageRaw === "" ? 1 : requireSafeInteger(pageRaw, "page", 1, 100000);
  const limit = limitRaw === undefined || limitRaw === "" ? 25 : requireSafeInteger(limitRaw, "limit", 1, 100);
  return { page, limit, offset: (page - 1) * limit };
}

export function pageResult<T>(items: T[], page: number, limit: number): { items: T[]; page: number; limit: number; hasMore: boolean } {
  return { items, page, limit, hasMore: items.length === limit };
}

export type ProductionRole = "supplier" | "admin" | "owner" | "sales" | "warehouse" | "finance";

export function assertProductionPermission(role: ProductionRole, action: string): void {
  if (role === "admin" || role === "owner") return;
  const permissions: Record<string, string[]> = {
    read: ["sales", "warehouse", "finance"],
    create_job: ["owner", "sales", "warehouse"],
    manage_capacity: ["warehouse"],
    progress_job: ["warehouse", "sales"],
    submit_sample: ["warehouse", "sales"],
    review_sample: [],
    change_request: ["sales", "warehouse"],
    submit_qc: ["warehouse"],
    manage_lot: ["warehouse"],
    request_release: ["warehouse"],
    recall_propose: ["owner", "warehouse", "sales"],
  };
  if (!permissions[action]?.includes(role)) {
    throw new ProductionDomainError("ROLE_NOT_ALLOWED", `Role ${role} cannot perform ${action}`, 403);
  }
}

export function assertArtifactMetadata(input: Record<string, unknown>): {
  artifactType: string;
  mimeType: string;
  objectKey: string;
  byteSize: number;
  checksumSha256: string;
  originalFilename: string | null;
} {
  const unsafeKeys = ["content", "contentBase64", "base64", "data", "buffer", "fileBytes"];
  if (unsafeKeys.some((key) => key in input)) {
    throw new ProductionDomainError("ARTIFACT_BYTES_NOT_ACCEPTED", "Production evidence accepts metadata only; raw bytes are not accepted", 400);
  }
  const artifactType = assertOneOf(input.artifactType, PRODUCTION_ARTIFACT_TYPES, "artifactType");
  const mimeType = assertOneOf(input.mimeType, PRODUCTION_ARTIFACT_MIME_TYPES, "mimeType");
  const objectKey = requireText(input.objectKey, "objectKey", 200);
  if (!/^production\/[a-zA-Z0-9/_\-.]{3,190}$/.test(objectKey) || objectKey.includes("..")) {
    throw new ProductionDomainError("ARTIFACT_KEY_INVALID", "Artifact object key is unsafe", 400);
  }
  const byteSize = requireSafeInteger(input.byteSize, "byteSize", 1, 5 * 1024 * 1024);
  const checksumSha256 = requireText(input.checksumSha256, "checksumSha256", 64);
  if (!/^[0-9a-f]{64}$/.test(checksumSha256)) {
    throw new ProductionDomainError("ARTIFACT_CHECKSUM_INVALID", "Artifact checksum must be lowercase SHA-256", 400);
  }
  const originalFilename = optionalText(input.originalFilename, "originalFilename", 120);
  if (originalFilename && /[\\/]/.test(originalFilename)) {
    throw new ProductionDomainError("ARTIFACT_FILENAME_INVALID", "Artifact filename must be a basename", 400);
  }
  return { artifactType, mimeType, objectKey, byteSize, checksumSha256, originalFilename };
}

export function calculateRates(sampleSize: number, acceptedUnits: number, defectUnits: number): { defectRateBps: number; passRateBps: number } {
  const sample = BigInt(sampleSize);
  const defectRateBps = Number((BigInt(defectUnits) * 10000n) / sample);
  const passRateBps = Number((BigInt(acceptedUnits) * 10000n) / sample);
  if (defectRateBps < 0 || defectRateBps > 10000 || passRateBps < 0 || passRateBps > 10000 || defectRateBps + passRateBps > 10000) {
    throw new ProductionDomainError("QC_RATE_OUT_OF_BOUNDS", "QC rates must be integer basis points between 0 and 10000");
  }
  return { defectRateBps, passRateBps };
}

export function assertInspectionArithmetic(input: { sampleSize: number; acceptedUnits: number; defectUnits: number; reworkUnits: number; rejectedUnits: number }): void {
  const values = [input.sampleSize, input.acceptedUnits, input.defectUnits, input.reworkUnits, input.rejectedUnits];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0) || input.sampleSize <= 0) {
    throw new ProductionDomainError("QC_QUANTITY_INVALID", "QC quantities must be non-negative integers and sample size must be positive");
  }
  if (input.sampleSize !== input.acceptedUnits + input.defectUnits + input.reworkUnits + input.rejectedUnits) {
    throw new ProductionDomainError("QC_ARITHMETIC_INVARIANT", "sampleSize must equal accepted + defect + rework + rejected", 422);
  }
  calculateRates(input.sampleSize, input.acceptedUnits, input.defectUnits);
}

export function assertChangeBoundary(input: { changeType: unknown; ownerDomain: unknown; commercialImpact?: boolean; deliveryImpact?: boolean }): { changeType: string; ownerDomain: string; commercialImpact: boolean; deliveryImpact: boolean } {
  const changeType = assertOneOf(input.changeType, PRODUCTION_CHANGE_TYPES, "changeType");
  const ownerDomain = assertOneOf(input.ownerDomain, PRODUCTION_CHANGE_OWNER_DOMAINS, "ownerDomain");
  const commercialImpact = input.commercialImpact === true || changeType === "commercial";
  const deliveryImpact = input.deliveryImpact === true || changeType === "delivery";
  if (commercialImpact && !["orders", "offers"].includes(ownerDomain)) {
    throw new ProductionDomainError("COMMERCIAL_OWNER_REQUIRED", "Commercial changes require the Orders or Offers owner workflow", 422);
  }
  if (deliveryImpact && ownerDomain !== "shipping") {
    throw new ProductionDomainError("SHIPPING_OWNER_REQUIRED", "Delivery changes require the Shipping owner workflow", 422);
  }
  return { changeType, ownerDomain, commercialImpact, deliveryImpact };
}

export function assertRecallScope(input: { severity: unknown; scopeType: unknown }): { severity: string; scopeType: string; highImpact: boolean } {
  const severity = assertOneOf(input.severity, PRODUCTION_RECALL_SEVERITIES, "severity");
  const scopeType = assertOneOf(input.scopeType, PRODUCTION_RECALL_SCOPE_TYPES, "scopeType");
  const highImpact = severity === "critical" || severity === "global" || scopeType === "global";
  return { severity, scopeType, highImpact };
}

export function availableCapacity(declared: number, reserved: number, unavailable: number): number {
  const available = declared - reserved - unavailable;
  if (!Number.isSafeInteger(available) || available < 0) {
    throw new ProductionDomainError("CAPACITY_INVARIANT", "Capacity available units cannot be negative", 409);
  }
  return available;
}

export const PRODUCTION_ALLOWED_JOB_STATUSES = PRODUCTION_JOB_STATUSES;
export const PRODUCTION_ALLOWED_MILESTONE_STATUSES = PRODUCTION_MILESTONE_STATUSES;
export const PRODUCTION_ALLOWED_SAMPLE_STATUSES = PRODUCTION_SAMPLE_STATUSES;
export const PRODUCTION_ALLOWED_SAMPLE_REVIEW_DECISIONS = PRODUCTION_SAMPLE_REVIEW_DECISIONS;
export const PRODUCTION_ALLOWED_INSPECTION_STATUSES = QUALITY_INSPECTION_STATUSES;
export const PRODUCTION_ALLOWED_DEFECT_STATUSES = QUALITY_DEFECT_STATUSES;
export const PRODUCTION_ALLOWED_REWORK_STATUSES = QUALITY_REWORK_STATUSES;
export const PRODUCTION_ALLOWED_LOT_STATUSES = PRODUCTION_LOT_STATUSES;
export const PRODUCTION_ALLOWED_RELEASE_STATUSES = QUALITY_RELEASE_STATUSES;
export const PRODUCTION_ALLOWED_MEASUREMENT_TYPES = QUALITY_MEASUREMENT_TYPES;
export const PRODUCTION_ALLOWED_DEFECT_SEVERITIES = QUALITY_DEFECT_SEVERITIES;

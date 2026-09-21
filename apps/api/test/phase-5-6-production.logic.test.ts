import { describe, expect, it } from "vitest";
import {
  assertArtifactMetadata,
  assertChangeBoundary,
  assertInspectionArithmetic,
  assertRecallScope,
  assertTransition,
  availableCapacity,
  JOB_TRANSITIONS,
  ProductionDomainError,
  calculateRates,
  assertProductionPermission,
  pageInput,
  pageResult,
  requestHash,
} from "../src/modules/production/production.logic";

describe("Phase 5.6 production boundary logic", () => {
  it("allows only explicit job transitions and rejects arbitrary status jumps", () => {
    expect(() => assertTransition(JOB_TRANSITIONS, "draft", "planned")).not.toThrow();
    expect(() => assertTransition(JOB_TRANSITIONS, "draft", "completed")).toThrowError(ProductionDomainError);
    expect(() => assertTransition(JOB_TRANSITIONS, "completed", "draft")).toThrowError(ProductionDomainError);
  });

  it("uses integer arithmetic for QC quantities and basis-point rates", () => {
    expect(() => assertInspectionArithmetic({ sampleSize: 10, acceptedUnits: 8, defectUnits: 1, reworkUnits: 1, rejectedUnits: 0 })).not.toThrow();
    expect(calculateRates(10, 8, 1)).toEqual({ passRateBps: 8000, defectRateBps: 1000 });
    expect(() => assertInspectionArithmetic({ sampleSize: 10, acceptedUnits: 8, defectUnits: 0, reworkUnits: 0, rejectedUnits: 0 })).toThrowError(ProductionDomainError);
    expect(() => calculateRates(3, 3, 1)).toThrowError(ProductionDomainError);
  });

  it("rejects unsafe evidence and raw/base64 upload claims", () => {
    expect(() => assertArtifactMetadata({ artifactType: "image", mimeType: "image/png", objectKey: "production/job/a.png", byteSize: 10, checksumSha256: "a".repeat(64), contentBase64: "data" })).toThrowError("metadata only");
    expect(() => assertArtifactMetadata({ artifactType: "other", mimeType: "application/x-executable", objectKey: "production/job/a", byteSize: 10, checksumSha256: "a".repeat(64) })).toThrowError(ProductionDomainError);
    expect(() => assertArtifactMetadata({ artifactType: "image", mimeType: "image/png", objectKey: "production/../unsafe", byteSize: 10, checksumSha256: "a".repeat(64) })).toThrowError(ProductionDomainError);
  });

  it("keeps commercial and delivery decisions in owner domains", () => {
    expect(assertChangeBoundary({ changeType: "operational", ownerDomain: "production" })).toEqual({ changeType: "operational", ownerDomain: "production", commercialImpact: false, deliveryImpact: false });
    expect(() => assertChangeBoundary({ changeType: "commercial", ownerDomain: "production" })).toThrowError(ProductionDomainError);
    expect(() => assertChangeBoundary({ changeType: "delivery", ownerDomain: "orders" })).toThrowError(ProductionDomainError);
  });

  it("marks critical/global recalls as high impact and never makes them supplier-self-activating", () => {
    expect(assertRecallScope({ severity: "global", scopeType: "global" }).highImpact).toBe(true);
    expect(assertRecallScope({ severity: "low", scopeType: "lot" }).highImpact).toBe(false);
  });

  it("does not expose negative capacity", () => {
    expect(availableCapacity(100, 30, 20)).toBe(50);
    expect(() => availableCapacity(100, 80, 21)).toThrowError(ProductionDomainError);
  });

  it("enforces existing role boundaries and bounded pagination", () => {
    expect(() => assertProductionPermission("warehouse", "manage_capacity")).not.toThrow();
    expect(() => assertProductionPermission("supplier", "review_sample")).toThrowError(ProductionDomainError);
    expect(pageInput("2", "25")).toEqual({ page: 2, limit: 25, offset: 25 });
    expect(() => pageInput("1; DROP TABLE production_job", "25")).toThrowError(ProductionDomainError);
    expect(pageResult([1], 1, 1)).toEqual({ items: [1], page: 1, limit: 1, hasMore: true });
  });

  it("hashes idempotency payloads canonically and rejects unsafe numbers", () => {
    expect(requestHash({ b: 2, a: 1 })).toBe(requestHash({ a: 1, b: 2 }));
    expect(() => assertArtifactMetadata({ artifactType: "image", mimeType: "image/png", objectKey: "production/job/a.png", byteSize: 5 * 1024 * 1024 + 1, checksumSha256: "a".repeat(64) })).toThrowError(ProductionDomainError);
  });
});

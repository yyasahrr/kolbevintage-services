/**
 * Phase 5.6 integration contracts. These are facts and references only;
 * owner modules still perform delivery, support, analytics and shipping work.
 */
export type ProductionNotificationFact = {
  sourceDomain: "production";
  eventType: string;
  sourceEntityType: string;
  sourceEntityId: string;
  supplierId: string;
  recipientScope: "SUPPLIER" | "SUPPLIER_MEMBER" | "ADMIN_USER" | null;
  recipientId: string | null;
  payload: Record<string, unknown>;
};

export type ProductionSupportReference = {
  domain: "support";
  caseId: string;
  sourceEntityType: string;
  sourceEntityId: string;
};

export type ProductionAnalyticsFact = {
  sourceDomain: "production";
  eventType: string;
  occurredAt: string;
  entityId: string;
  supplierId: string;
  facts: Record<string, string | number | boolean | null>;
};

export type ProductionAuditReference = {
  domain: "audit";
  action: string;
  entityType: string;
  entityId: string;
};

export type ProductionShippingHandoff = {
  domain: "shipping";
  eligible: true;
  purchaseOrderId: string;
  productionJobId: string;
  lotIds: string[];
  qualityReleaseId: string;
  source: "quality_release";
};

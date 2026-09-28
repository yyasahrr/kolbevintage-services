import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { SuppliersModule } from "../suppliers/suppliers.module";
import { ComplianceService } from "./compliance.service";
import { SupplierComplianceService } from "./supplier-compliance.service";
import { ProductComplianceService } from "./product-compliance.service";
import { PrivacyService } from "./privacy.service";
import { ComplianceKeyring } from "./compliance.hashing";
import { DocumentAccessSigner, LocalPrivateDocumentStorage } from "./document-storage";
import { CompliancePublicController } from "./compliance-public.controller";
import { ComplianceAccountController } from "./compliance-account.controller";
import { ComplianceSupplierController } from "./compliance-supplier.controller";
import { ComplianceAdminController } from "./compliance-admin.controller";

/**
 * Phase 4.7.5 — Iran legal, compliance, privacy & tax-readiness foundation.
 *
 * Dependency direction: Finance / Catalog / Invoicing → Compliance.
 * Compliance depends only on Audit and Suppliers (membership facts). It never
 * imports Orders, Payments, Shipping, Inventory, Catalog or Offers, so the
 * publication gate (Catalog → Compliance) and the supplier provenance routes
 * (Offers → Compliance) create no cycle and no circular module reference is needed anywhere.
 */
@Module({
  imports: [DatabaseModule, AuditModule, SuppliersModule],
  controllers: [CompliancePublicController, ComplianceAccountController, ComplianceSupplierController, ComplianceAdminController],
  providers: [ComplianceKeyring, LocalPrivateDocumentStorage, DocumentAccessSigner, ComplianceService, SupplierComplianceService, ProductComplianceService, PrivacyService],
  exports: [ComplianceService, SupplierComplianceService, ProductComplianceService, PrivacyService],
})
export class ComplianceModule {}

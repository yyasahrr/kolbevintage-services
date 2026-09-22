import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import { CustomerAddressRepository } from "./customer-address.repository";
import {
  CustomerAccountDomainError,
  type CreateCustomerAddressInput,
  type CustomerAddressView,
  type UpdateCustomerAddressInput,
} from "./customer-account.contract";

const MAX_ADDRESSES_PER_CUSTOMER = 20;

function text(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function displayText(value: unknown, maxLength: number): string {
  return text(value, maxLength).replace(/[<>]/g, "");
}

function normalizePhone(value: unknown): string {
  return text(value, 32).replace(/[\s-]/g, "");
}

function isIranianMobile(phone: string): boolean {
  return /^(?:\+98|0098|98|0)?9\d{9}$/.test(phone);
}

/** Iranian postal code: 10 ASCII digits (Persian/Arabic digits normalized). */
function normalizePostalCode(value: unknown): string {
  const ascii = text(value, 16)
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  return ascii.replace(/\D/g, "");
}

function fieldError(field: string): CustomerAccountDomainError {
  return new CustomerAccountDomainError("CUSTOMER_ADDRESS_FIELD_INVALID", `address field "${field}" is invalid`);
}

function present(row: any): CustomerAddressView {
  return {
    id: row.id,
    label: row.label ?? "آدرس",
    recipientName: row.recipientName,
    recipientPhone: row.recipientPhone,
    province: row.province,
    city: row.city,
    addressLine: row.addressLine,
    plaque: row.plaque ?? null,
    unit: row.unit ?? null,
    postalCode: row.postalCode,
    isDefault: row.isDefault,
    version: row.version,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/**
 * Phase 5.9-A — saved-address book. Ownership is structural: every method
 * re-resolves the row and compares `user_id` to the session user; archived
 * rows are invisible to reads and immutable to writes. Order address
 * snapshots stay frozen — editing the book never rewrites placed orders.
 */
@Injectable()
export class CustomerAddressService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(CustomerAddressRepository) private readonly repo: CustomerAddressRepository,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async listAddresses(userId: string): Promise<CustomerAddressView[]> {
    const rows = await this.repo.listByUserId(userId);
    return rows.map(present);
  }

  async createAddress(userId: string, input: CreateCustomerAddressInput): Promise<CustomerAddressView> {
    const parsed = this.parseCreate(input);
    return this.db.transaction(async (tx) => {
      await this.repo.advisoryLock(userId, tx);
      const count = await this.repo.countByUserId(userId, tx);
      if (count >= MAX_ADDRESSES_PER_CUSTOMER) {
        throw new CustomerAccountDomainError(
          "CUSTOMER_ADDRESS_LIMIT_REACHED",
          `at most ${MAX_ADDRESSES_PER_CUSTOMER} saved addresses per customer`,
        );
      }
      if (parsed.isDefault) await this.repo.clearDefaults(userId, tx);
      let created: any;
      try {
        created = await this.repo.insert(
          {
            id: `cadr_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
            userId,
            label: parsed.label,
            recipientName: parsed.recipientName,
            recipientPhone: parsed.recipientPhone,
            province: parsed.province,
            city: parsed.city,
            addressLine: parsed.addressLine,
            plaque: parsed.plaque,
            unit: parsed.unit,
            postalCode: parsed.postalCode,
            isDefault: parsed.isDefault,
            version: 0,
          },
          tx,
        );
      } catch (error) {
        if (this.isDefaultConflict(error)) {
          throw new CustomerAccountDomainError(
            "CUSTOMER_ADDRESS_DEFAULT_CONFLICT",
            "another default address was set concurrently; retry",
          );
        }
        throw error;
      }
      await this.audit.record(
        {
          actorId: userId,
          actorRole: "customer",
          action: "customer_address.created",
          entityType: "customer_address",
          entityId: created.id,
          after: { label: parsed.label, city: parsed.city, is_default: parsed.isDefault },
        },
        tx,
      );
      return present(created);
    });
  }

  async updateAddress(userId: string, id: string, input: UpdateCustomerAddressInput): Promise<CustomerAddressView> {
    if (typeof input.version !== "number" || !Number.isInteger(input.version) || input.version < 0) {
      throw new CustomerAccountDomainError("CUSTOMER_ADDRESS_VERSION_INVALID", "address version is required for updates");
    }
    const expectedVersion = input.version;
    const parsed = this.parseUpdate(input);
    return this.db.transaction(async (tx) => {
      await this.repo.advisoryLock(userId, tx);
      const current = await this.resolveOwned(id, userId, tx);
      if (parsed.isDefault === true) await this.repo.clearDefaults(userId, tx);
      if (parsed.isDefault === false && current.isDefault) {
        throw new CustomerAccountDomainError(
          "CUSTOMER_ADDRESS_DEFAULT_REQUIRED",
          "unset the default only by making another address default",
        );
      }
      let updated: any = null;
      try {
        updated = await this.repo.updateVersioned(id, expectedVersion, parsed.patch as any, tx);
      } catch (error) {
        if (this.isDefaultConflict(error)) {
          throw new CustomerAccountDomainError(
            "CUSTOMER_ADDRESS_DEFAULT_CONFLICT",
            "another default address was set concurrently; retry",
          );
        }
        throw error;
      }
      if (!updated) {
        throw new CustomerAccountDomainError(
          "CUSTOMER_ADDRESS_VERSION_CONFLICT",
          "address changed since it was read; reload and retry",
        );
      }
      await this.audit.record(
        {
          actorId: userId,
          actorRole: "customer",
          action: "customer_address.updated",
          entityType: "customer_address",
          entityId: id,
          before: { version: expectedVersion },
          after: { version: updated.version },
        },
        tx,
      );
      return present(updated);
    });
  }

  async makeDefault(userId: string, id: string): Promise<CustomerAddressView> {
    return this.db.transaction(async (tx) => {
      await this.repo.advisoryLock(userId, tx);
      const current = await this.resolveOwned(id, userId, tx);
      if (current.isDefault) return present(current);
      try {
        await this.repo.clearDefaults(userId, tx);
        const updated = await this.repo.updateVersioned(id, current.version, { isDefault: true }, tx);
        if (!updated) {
          throw new CustomerAccountDomainError(
            "CUSTOMER_ADDRESS_VERSION_CONFLICT",
            "address changed since it was read; reload and retry",
          );
        }
        await this.audit.record(
          {
            actorId: userId,
            actorRole: "customer",
            action: "customer_address.default_changed",
            entityType: "customer_address",
            entityId: id,
          },
          tx,
        );
        return present(updated);
      } catch (error) {
        if (error instanceof CustomerAccountDomainError) throw error;
        if (this.isDefaultConflict(error)) {
          throw new CustomerAccountDomainError(
            "CUSTOMER_ADDRESS_DEFAULT_CONFLICT",
            "another default address was set concurrently; retry",
          );
        }
        throw error;
      }
    });
  }

  /**
   * Soft archive (DELETE). The row survives for audit; the default flag
   * stays untouched (the partial unique ignores archived rows). Archiving
   * the default does NOT auto-promote another address — the customer must
   * pick a new default explicitly.
   */
  async archiveAddress(userId: string, id: string): Promise<{ id: string; archivedAt: string }> {
    return this.db.transaction(async (tx) => {
      const current = await this.resolveOwned(id, userId, tx);
      const updated = await this.repo.updateVersioned(id, current.version, { archivedAt: new Date() }, tx);
      if (!updated) {
        throw new CustomerAccountDomainError(
          "CUSTOMER_ADDRESS_VERSION_CONFLICT",
          "address changed since it was read; reload and retry",
        );
      }
      await this.audit.record(
        {
          actorId: userId,
          actorRole: "customer",
          action: "customer_address.archived",
          entityType: "customer_address",
          entityId: id,
        },
        tx,
      );
      return { id, archivedAt: new Date(updated.archivedAt).toISOString() };
    });
  }

  private async resolveOwned(id: string, userId: string, executor?: any): Promise<any> {
    const row = await this.repo.findById(id, executor);
    if (!row || row.archivedAt) {
      throw new CustomerAccountDomainError("CUSTOMER_ADDRESS_NOT_FOUND", "address not found");
    }
    if (row.userId !== userId) {
      throw new CustomerAccountDomainError("CUSTOMER_ADDRESS_FORBIDDEN", "this address belongs to another customer");
    }
    return row;
  }

  private parseCreate(input: CreateCustomerAddressInput): {
    label: string;
    recipientName: string;
    recipientPhone: string;
    province: string;
    city: string;
    addressLine: string;
    plaque: string | null;
    unit: string | null;
    postalCode: string;
    isDefault: boolean;
  } {
    const label = displayText(input.label, 64) || "آدرس";
    const recipientName = displayText(input.recipientName, 160);
    const recipientPhone = normalizePhone(input.recipientPhone);
    const province = displayText(input.province, 64);
    const city = displayText(input.city, 64);
    const addressLine = displayText(input.addressLine, 512);
    const plaque = displayText(input.plaque, 16) || null;
    const unit = displayText(input.unit, 16) || null;
    const postalCode = normalizePostalCode(input.postalCode);
    if (!recipientName) throw fieldError("recipientName");
    if (!isIranianMobile(recipientPhone)) throw fieldError("recipientPhone");
    if (!province) throw fieldError("province");
    if (!city) throw fieldError("city");
    if (!addressLine) throw fieldError("addressLine");
    if (!/^\d{10}$/.test(postalCode)) throw fieldError("postalCode");
    return { label, recipientName, recipientPhone, province, city, addressLine, plaque, unit, postalCode, isDefault: input.isDefault === true };
  }

  private parseUpdate(input: UpdateCustomerAddressInput): {
    patch: Record<string, string | boolean | null>;
    isDefault: boolean | null;
  } {
    const patch: Record<string, string | boolean | null> = {};
    if (input.label !== undefined) patch.label = displayText(input.label, 64) || "آدرس";
    if (input.recipientName !== undefined) {
      const value = displayText(input.recipientName, 160);
      if (!value) throw fieldError("recipientName");
      patch.recipientName = value;
    }
    if (input.recipientPhone !== undefined) {
      const value = normalizePhone(input.recipientPhone);
      if (!isIranianMobile(value)) throw fieldError("recipientPhone");
      patch.recipientPhone = value;
    }
    if (input.province !== undefined) {
      const value = displayText(input.province, 64);
      if (!value) throw fieldError("province");
      patch.province = value;
    }
    if (input.city !== undefined) {
      const value = displayText(input.city, 64);
      if (!value) throw fieldError("city");
      patch.city = value;
    }
    if (input.addressLine !== undefined) {
      const value = displayText(input.addressLine, 512);
      if (!value) throw fieldError("addressLine");
      patch.addressLine = value;
    }
    if (input.plaque !== undefined) patch.plaque = input.plaque === null ? null : displayText(input.plaque, 16) || null;
    if (input.unit !== undefined) patch.unit = input.unit === null ? null : displayText(input.unit, 16) || null;
    if (input.postalCode !== undefined) {
      const value = normalizePostalCode(input.postalCode);
      if (!/^\d{10}$/.test(value)) throw fieldError("postalCode");
      patch.postalCode = value;
    }
    let isDefault: boolean | null = null;
    if (input.isDefault !== undefined) {
      isDefault = input.isDefault === true;
      patch.isDefault = isDefault;
    }
    return { patch, isDefault };
  }

  private isDefaultConflict(error: unknown): boolean {
    const code = (error as { code?: unknown })?.code;
    const constraint = String((error as { constraint?: unknown })?.constraint ?? "");
    return code === "23505" && constraint.includes("customer_address_single_default");
  }
}

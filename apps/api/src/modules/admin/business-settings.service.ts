import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import {
  businessSetting,
  businessSettingHistory,
  BUSINESS_SETTING_CATEGORIES,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import {
  BusinessSettingReadOnlyError,
  BusinessSettingValidationError,
} from "./admin.errors";

export interface SetSettingInput {
  category?: (typeof BUSINESS_SETTING_CATEGORIES)[number];
  value: any;
  valueType?: "string" | "number" | "boolean" | "json" | "money_irr";
  description?: string;
  isSecret?: boolean;
  isReadOnly?: boolean;
  reason?: string;
}

@Injectable()
export class BusinessSettingsService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  private makeId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  }

  private validateAndFormatValue(value: any, valueType: string): any {
    switch (valueType) {
      case "number": {
        const num = Number(value);
        if (isNaN(num)) {
          throw new BusinessSettingValidationError(`Value '${value}' is not a valid number`);
        }
        return num;
      }
      case "boolean": {
        if (typeof value === "boolean") return value;
        if (value === "true" || value === 1) return true;
        if (value === "false" || value === 0) return false;
        throw new BusinessSettingValidationError(`Value '${value}' is not a valid boolean`);
      }
      case "money_irr": {
        try {
          const big = BigInt(value);
          if (big < 0n) {
            throw new BusinessSettingValidationError(`IRR Money value cannot be negative: ${value}`);
          }
          return big.toString();
        } catch {
          throw new BusinessSettingValidationError(`Value '${value}' is not a valid IRR money bigint`);
        }
      }
      case "json": {
        if (typeof value === "object" && value !== null) {
          return value;
        }
        try {
          return JSON.parse(value);
        } catch {
          throw new BusinessSettingValidationError(`Value '${value}' is not a valid JSON`);
        }
      }
      case "string":
      default:
        return String(value);
    }
  }

  async setSetting(
    key: string,
    input: SetSettingInput,
    actorId: string,
  ) {
    const valueType = input.valueType || "string";
    const formattedValue = this.validateAndFormatValue(input.value, valueType);
    const category = input.category || "wholesale";

    return await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(businessSetting)
        .where(eq(businessSetting.key, key))
        .limit(1);

      if (existing) {
        if (existing.isReadOnly) {
          throw new BusinessSettingReadOnlyError(key);
        }

        const newVersion = existing.version + 1;
        const [updated] = await tx
          .update(businessSetting)
          .set({
            value: formattedValue,
            valueType,
            description: input.description ?? existing.description,
            isSecret: input.isSecret ?? existing.isSecret,
            isReadOnly: input.isReadOnly ?? existing.isReadOnly,
            category: input.category ?? existing.category,
            version: newVersion,
            updatedBy: actorId,
          })
          .where(eq(businessSetting.id, existing.id))
          .returning();

        // Record history snapshot
        await tx.insert(businessSettingHistory).values({
          id: this.makeId("bsh"),
          settingId: existing.id,
          key,
          previousValue: existing.value,
          newValue: formattedValue,
          version: newVersion,
          reason: input.reason || "Setting update",
          changedBy: actorId,
        });

        await this.auditService.record({
          actorId,
          actorRole: "admin",
          action: "business_setting_updated",
          entityType: "business_setting",
          entityId: existing.id,
          metadata: { key, oldVersion: existing.version, newVersion, reason: input.reason },
        });

        return updated;
      }

      // New setting creation
      const settingId = this.makeId("bset");
      const [created] = await tx
        .insert(businessSetting)
        .values({
          id: settingId,
          key,
          category,
          value: formattedValue,
          valueType,
          description: input.description,
          isSecret: input.isSecret ?? false,
          isReadOnly: input.isReadOnly ?? false,
          version: 1,
          updatedBy: actorId,
        })
        .returning();

      await tx.insert(businessSettingHistory).values({
        id: this.makeId("bsh"),
        settingId,
        key,
        previousValue: null,
        newValue: formattedValue,
        version: 1,
        reason: input.reason || "Initial creation",
        changedBy: actorId,
      });

      await this.auditService.record({
        actorId,
        actorRole: "admin",
        action: "business_setting_created",
        entityType: "business_setting",
        entityId: settingId,
        metadata: { key, category, valueType },
      });

      return created;
    });
  }

  async getSetting<T = any>(key: string, revealSecret = false): Promise<T | null> {
    const [row] = await this.db
      .select()
      .from(businessSetting)
      .where(eq(businessSetting.key, key))
      .limit(1);

    if (!row) return null;

    if (row.isSecret && !revealSecret) {
      return "********" as unknown as T;
    }

    return row.value as T;
  }

  async getSettingRecord(key: string, revealSecret = false) {
    const [row] = await this.db
      .select()
      .from(businessSetting)
      .where(eq(businessSetting.key, key))
      .limit(1);

    if (!row) return null;

    if (row.isSecret && !revealSecret) {
      return {
        ...row,
        value: "********",
      };
    }

    return row;
  }

  async listSettings(category?: string, revealSecrets = false) {
    const query = this.db.select().from(businessSetting);
    const rows = category
      ? await query.where(eq(businessSetting.category, category))
      : await query;

    return rows.map((r) => ({
      ...r,
      value: r.isSecret && !revealSecrets ? "********" : r.value,
    }));
  }

  async getSettingHistory(key: string) {
    return await this.db
      .select()
      .from(businessSettingHistory)
      .where(eq(businessSettingHistory.key, key))
      .orderBy(desc(businessSettingHistory.version));
  }
}

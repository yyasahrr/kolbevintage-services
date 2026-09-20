import { Inject, Injectable } from "@nestjs/common";
import { and, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import {
  accountUser,
  crmContact,
  crmContactIdentityLink,
  CRM_STAGES,
  type CrmStage,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { CrmContactService, type ListContactsFilter } from "./crm-contact.service";

export interface DuplicateCheckInput {
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  excludeContactId?: string;
}

export interface DuplicateCheckResult {
  hasDuplicate: boolean;
  signals: {
    byPhone: boolean;
    byEmail: boolean;
    byName: boolean;
  };
  matchingContacts: Array<{
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    stage: string;
  }>;
  matchingUsers: Array<{
    id: string;
    displayName: string | null;
    phone: string | null;
    email: string;
    role: string;
  }>;
}

@Injectable()
export class CrmOperationsService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(CrmContactService) private readonly contactService: CrmContactService,
  ) {}

  async getPipelineMetrics(assignedAdminId?: string) {
    const conditions = [];
    if (assignedAdminId) {
      conditions.push(eq(crmContact.assignedAdminId, assignedAdminId));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await this.db
      .select({
        stage: crmContact.stage,
        totalCount: sql<number>`count(*)::int`,
        assignedCount: sql<number>`count(case when ${crmContact.assignedAdminId} is not null then 1 end)::int`,
        unassignedCount: sql<number>`count(case when ${crmContact.assignedAdminId} is null then 1 end)::int`,
      })
      .from(crmContact)
      .where(whereClause)
      .groupBy(crmContact.stage);

    const stageMap = new Map<string, { count: number; assignedCount: number; unassignedCount: number }>();
    for (const r of rows) {
      stageMap.set(r.stage, {
        count: r.totalCount,
        assignedCount: r.assignedCount,
        unassignedCount: r.unassignedCount,
      });
    }

    let totalContacts = 0;
    let totalAssigned = 0;
    let totalUnassigned = 0;
    let activeCustomerCount = 0;

    const stages = CRM_STAGES.map((s) => {
      const data = stageMap.get(s) || { count: 0, assignedCount: 0, unassignedCount: 0 };
      totalContacts += data.count;
      totalAssigned += data.assignedCount;
      totalUnassigned += data.unassignedCount;
      if (s === "ACTIVE_CUSTOMER" || s === "LOYAL") {
        activeCustomerCount += data.count;
      }
      return {
        stage: s,
        count: data.count,
        assignedCount: data.assignedCount,
        unassignedCount: data.unassignedCount,
      };
    });

    const conversionRatePct =
      totalContacts > 0 ? Math.round((activeCustomerCount / totalContacts) * 10000) / 100 : 0;

    return {
      stages,
      summary: {
        totalContacts,
        totalAssigned,
        totalUnassigned,
        activeCustomerCount,
        conversionRatePct,
      },
    };
  }

  async checkDuplicates(input: DuplicateCheckInput): Promise<DuplicateCheckResult> {
    const cleanPhone = this.contactService.normalizePhone(input.phone);
    const cleanEmail = this.contactService.normalizeEmail(input.email);
    const cleanName = input.name?.trim() || null;

    const contactConditions = [];
    if (cleanPhone) contactConditions.push(eq(crmContact.phone, cleanPhone));
    if (cleanEmail) contactConditions.push(eq(crmContact.email, cleanEmail));
    if (cleanName && cleanName.length >= 3) {
      contactConditions.push(ilike(crmContact.name, cleanName));
    }

    let matchingContacts: DuplicateCheckResult["matchingContacts"] = [];
    if (contactConditions.length > 0) {
      const baseQuery = this.db
        .select({
          id: crmContact.id,
          name: crmContact.name,
          phone: crmContact.phone,
          email: crmContact.email,
          stage: crmContact.stage,
        })
        .from(crmContact);

      const filter = or(...contactConditions);
      if (input.excludeContactId) {
        matchingContacts = await baseQuery.where(and(filter, ne(crmContact.id, input.excludeContactId)));
      } else {
        matchingContacts = await baseQuery.where(filter);
      }
    }

    const userConditions = [];
    if (cleanPhone) userConditions.push(eq(accountUser.phone, cleanPhone));
    if (cleanEmail) userConditions.push(eq(accountUser.email, cleanEmail));

    let matchingUsers: DuplicateCheckResult["matchingUsers"] = [];
    if (userConditions.length > 0) {
      matchingUsers = await this.db
        .select({
          id: accountUser.id,
          displayName: accountUser.displayName,
          phone: accountUser.phone,
          email: accountUser.email,
          role: accountUser.role,
        })
        .from(accountUser)
        .where(or(...userConditions));
    }

    const byPhone = cleanPhone
      ? matchingContacts.some((c) => c.phone === cleanPhone) ||
        matchingUsers.some((u) => u.phone === cleanPhone)
      : false;

    const byEmail = cleanEmail
      ? matchingContacts.some((c) => c.email === cleanEmail) ||
        matchingUsers.some((u) => u.email === cleanEmail)
      : false;

    const byName = cleanName
      ? matchingContacts.some((c) => c.name.toLowerCase() === cleanName.toLowerCase())
      : false;

    return {
      hasDuplicate: matchingContacts.length > 0 || matchingUsers.length > 0,
      signals: {
        byPhone,
        byEmail,
        byName,
      },
      matchingContacts,
      matchingUsers,
    };
  }

  /**
   * Sanitizes a cell for CSV export to prevent Formula Injection (CSV Injection).
   * Prepends a single quote if the text begins with dangerous formula characters:
   * '=', '+', '-', '@', tab, carriage return, or '%'.
   */
  sanitizeCsvCell(value: unknown): string {
    if (value === null || value === undefined) return '""';
    let str = String(value);
    if (/^[\=\+\-\@\t\r%]/.test(str)) {
      str = `'${str}`;
    }
    str = str.replace(/"/g, '""');
    return `"${str}"`;
  }

  async exportContactsCsv(filter: ListContactsFilter = {}): Promise<string> {
    const result = await this.contactService.listContacts({
      ...filter,
      limit: 10000,
      offset: 0,
    });

    const headers = [
      "شناسه",
      "نام مخاطب",
      "شماره تلفن",
      "ایمیل",
      "شهر",
      "وضعیت (مرحله)",
      "کارشناس مسئول",
      "تاریخ ثبت",
    ];

    const lines = [headers.map((h) => this.sanitizeCsvCell(h)).join(",")];

    for (const item of result.items) {
      const row = [
        this.sanitizeCsvCell(item.id),
        this.sanitizeCsvCell(item.name),
        this.sanitizeCsvCell(item.phone || ""),
        this.sanitizeCsvCell(item.email || ""),
        this.sanitizeCsvCell(item.city || ""),
        this.sanitizeCsvCell(item.stage),
        this.sanitizeCsvCell(item.assignedAdminName || "نامشخص"),
        this.sanitizeCsvCell(item.createdAt.toISOString()),
      ];
      lines.push(row.join(","));
    }

    // UTF-8 BOM prefix for Microsoft Excel compatibility with Persian characters
    return `\uFEFF${lines.join("\r\n")}`;
  }
}

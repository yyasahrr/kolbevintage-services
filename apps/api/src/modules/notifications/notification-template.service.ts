import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  accountUser,
  notificationTemplate,
  notificationTemplateVersion,
  type NotificationChannel,
  type NotificationCategory,
  type NotificationEventKey,
  type NotificationTemplateStatus,
  type NotificationTemplateVersionStatus,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import {
  NotificationTemplateNotFoundError,
  NotificationTemplatePublishedImmutableError,
  NotificationTemplateRenderError,
  NotificationTemplateValidationError,
  NotificationTemplateVersionNotFoundError,
} from "./notifications.errors";
import crypto from "node:crypto";

const SENSITIVE_KEYWORDS = [
  "password",
  "secret",
  "token",
  "apikey",
  "api_key",
  "card_number",
  "cvv",
  "credit_card",
  "pin",
  "private_key",
  "auth_header",
];

const VARIABLE_REGEX = /\{\{([a-zA-Z0-9_]+)\}\}/g;

export interface CreateTemplateInput {
  templateKey: string;
  name: string;
  eventKey: NotificationEventKey;
  channel: NotificationChannel;
  locale?: string;
  category?: NotificationCategory;
  initialVersion: {
    subject?: string;
    body: string;
    variablesSchema?: string[];
  };
  adminUserId?: string;
}

export interface CreateDraftVersionInput {
  subject?: string;
  body: string;
  variablesSchema?: string[];
  adminUserId?: string;
}

export interface RenderResult {
  subject?: string;
  body: string;
}

@Injectable()
export class NotificationTemplateService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Extract variable names from a text string.
   */
  public extractVariables(text: string): string[] {
    const vars = new Set<string>();
    const matches = text.matchAll(VARIABLE_REGEX);
    for (const match of matches) {
      vars.add(match[1]);
    }
    return Array.from(vars);
  }

  /**
   * Validate that template variables do not contain sensitive identifiers
   * or prohibited JavaScript expressions.
   */
  public validateVariables(variableNames: string[]): void {
    for (const varName of variableNames) {
      const lower = varName.toLowerCase();
      for (const sensitive of SENSITIVE_KEYWORDS) {
        if (lower.includes(sensitive)) {
          throw new NotificationTemplateValidationError(
            `Template variable '${varName}' is prohibited as it represents sensitive data.`,
          );
        }
      }
      if (!/^[a-zA-Z0-9_]+$/.test(varName)) {
        throw new NotificationTemplateValidationError(
          `Template variable '${varName}' contains invalid characters. Only alphanumeric and underscore allowed.`,
        );
      }
    }
  }

  /**
   * Validate that all variables in template body & subject are declared in schema.
   */
  public validateContentAgainstSchema(
    body: string,
    subject: string | undefined,
    schema: string[],
  ): void {
    const usedVars = new Set<string>([
      ...this.extractVariables(body),
      ...(subject ? this.extractVariables(subject) : []),
    ]);

    this.validateVariables(Array.from(usedVars));

    const schemaSet = new Set(schema);
    for (const v of usedVars) {
      if (!schemaSet.has(v)) {
        throw new NotificationTemplateValidationError(
          `Template contains variable '{{${v}}}' which is not defined in the variables schema.`,
        );
      }
    }
  }

  /**
   * Safely escape HTML entities for Email channels.
   */
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * Sanitize email subjects to prevent CRLF header injection.
   */
  public sanitizeSubject(subject: string): string {
    return subject.replace(/[\r\n]+/g, " ").trim();
  }

  /**
   * Render template with variable substitutions and channel-specific escaping.
   */
  public render(
    subjectTemplate: string | null | undefined,
    bodyTemplate: string,
    variables: Record<string, unknown>,
    channel: NotificationChannel,
  ): RenderResult {
    const requiredVars = new Set<string>([
      ...this.extractVariables(bodyTemplate),
      ...(subjectTemplate ? this.extractVariables(subjectTemplate) : []),
    ]);

    for (const v of requiredVars) {
      if (variables[v] === undefined || variables[v] === null) {
        throw new NotificationTemplateRenderError(
          `Missing required template variable '{{${v}}}' during rendering.`,
        );
      }
    }

    const interpolate = (text: string, isSubject = false) => {
      let result = text.replace(VARIABLE_REGEX, (_match, varName) => {
        const val = variables[varName];
        const stringVal = typeof val === "object" ? JSON.stringify(val) : String(val);
        if (channel === "EMAIL" && !isSubject) {
          return this.escapeHtml(stringVal);
        }
        return stringVal;
      });

      if (isSubject) {
        result = this.sanitizeSubject(result);
      }
      return result;
    };

    const renderedSubject = subjectTemplate ? interpolate(subjectTemplate, true) : undefined;
    const renderedBody = interpolate(bodyTemplate, false);

    return {
      subject: renderedSubject,
      body: renderedBody,
    };
  }

  /**
   * Create a new notification template and its initial DRAFT version 1.
   */
  public async createTemplate(input: CreateTemplateInput) {
    const templateId = `ntpl_${crypto.randomUUID()}`;
    const versionId = `ntpv_${crypto.randomUUID()}`;
    const schema = input.initialVersion.variablesSchema ?? [
      ...this.extractVariables(input.initialVersion.body),
      ...(input.initialVersion.subject ? this.extractVariables(input.initialVersion.subject) : []),
    ];

    this.validateContentAgainstSchema(input.initialVersion.body, input.initialVersion.subject, schema);

    const [created] = await this.db.transaction(async (tx) => {
      const [tpl] = await tx
        .insert(notificationTemplate)
        .values({
          id: templateId,
          templateKey: input.templateKey,
          name: input.name,
          eventKey: input.eventKey,
          channel: input.channel,
          locale: input.locale ?? "fa-IR",
          category: input.category ?? "TRANSACTIONAL",
          status: "ACTIVE",
        })
        .returning();

      const [ver] = await tx
        .insert(notificationTemplateVersion)
        .values({
          id: versionId,
          templateId: tpl.id,
          version: 1,
          subject: input.initialVersion.subject ?? null,
          body: input.initialVersion.body,
          variablesSchema: schema,
          status: "DRAFT",
          createdBy: input.adminUserId ?? null,
        })
        .returning();

      return [{ ...tpl, initialVersion: ver }];
    });

    if (input.adminUserId) {
      await this.audit.record({
        action: "notification_template.created",
        actorId: input.adminUserId,
        actorRole: "admin",
        entityId: created.id,
        entityType: "notification_template",
        metadata: {
          templateKey: created.templateKey,
          eventKey: created.eventKey,
          channel: created.channel,
        },
      });
    }

    return created;
  }

  /**
   * Create a new draft version for an existing template.
   */
  public async createDraftVersion(templateId: string, input: CreateDraftVersionInput) {
    const [tpl] = await this.db
      .select()
      .from(notificationTemplate)
      .where(eq(notificationTemplate.id, templateId))
      .limit(1);

    if (!tpl) {
      throw new NotificationTemplateNotFoundError(templateId);
    }

    const versions = await this.db
      .select()
      .from(notificationTemplateVersion)
      .where(eq(notificationTemplateVersion.templateId, templateId))
      .orderBy(desc(notificationTemplateVersion.version));

    const maxVersion = versions[0]?.version ?? 0;
    const nextVersion = maxVersion + 1;

    const schema = input.variablesSchema ?? [
      ...this.extractVariables(input.body),
      ...(input.subject ? this.extractVariables(input.subject) : []),
    ];

    this.validateContentAgainstSchema(input.body, input.subject, schema);

    const versionId = `ntpv_${crypto.randomUUID()}`;
    const [ver] = await this.db
      .insert(notificationTemplateVersion)
      .values({
        id: versionId,
        templateId: tpl.id,
        version: nextVersion,
        subject: input.subject ?? null,
        body: input.body,
        variablesSchema: schema,
        status: "DRAFT",
        createdBy: input.adminUserId ?? null,
      })
      .returning();

    if (input.adminUserId) {
      await this.audit.record({
        action: "notification_template.version_created",
        actorId: input.adminUserId,
        actorRole: "admin",
        entityId: ver.id,
        entityType: "notification_template_version",
        metadata: {
          templateId,
          version: nextVersion,
        },
      });
    }

    return ver;
  }

  /**
   * Publish a draft version. If another version was previously PUBLISHED,
   * it transitions to SUPERSEDED.
   */
  public async publishVersion(templateId: string, versionNumber: number, adminUserId: string) {
    const [tpl] = await this.db
      .select()
      .from(notificationTemplate)
      .where(eq(notificationTemplate.id, templateId))
      .limit(1);

    if (!tpl) {
      throw new NotificationTemplateNotFoundError(templateId);
    }

    const [targetVer] = await this.db
      .select()
      .from(notificationTemplateVersion)
      .where(
        and(
          eq(notificationTemplateVersion.templateId, templateId),
          eq(notificationTemplateVersion.version, versionNumber),
        ),
      )
      .limit(1);

    if (!targetVer) {
      throw new NotificationTemplateVersionNotFoundError(templateId, versionNumber);
    }

    if (targetVer.status === "PUBLISHED") {
      return targetVer;
    }

    if (targetVer.status === "SUPERSEDED" || targetVer.status === "ARCHIVED") {
      throw new NotificationTemplateValidationError(
        `Cannot publish a template version with status '${targetVer.status}'.`,
      );
    }

    // Validate variables schema
    const schema = (targetVer.variablesSchema as string[]) ?? [];
    this.validateContentAgainstSchema(targetVer.body, targetVer.subject ?? undefined, schema);

    return await this.db.transaction(async (tx) => {
      // Supersede previously published version
      await tx
        .update(notificationTemplateVersion)
        .set({ status: "SUPERSEDED" })
        .where(
          and(
            eq(notificationTemplateVersion.templateId, templateId),
            eq(notificationTemplateVersion.status, "PUBLISHED"),
          ),
        );

      const [published] = await tx
        .update(notificationTemplateVersion)
        .set({
          status: "PUBLISHED",
          publishedBy: adminUserId,
          publishedAt: new Date(),
        })
        .where(eq(notificationTemplateVersion.id, targetVer.id))
        .returning();

      await this.audit.record({
        action: "notification_template.published",
        actorId: adminUserId,
        actorRole: "admin",
        entityId: published.id,
        entityType: "notification_template_version",
        metadata: {
          templateId,
          version: versionNumber,
        },
      });

      return published;
    });
  }

  /**
   * Archive a template.
   */
  public async archiveTemplate(templateId: string, adminUserId: string) {
    const [tpl] = await this.db
      .update(notificationTemplate)
      .set({ status: "ARCHIVED", updatedAt: new Date() })
      .where(eq(notificationTemplate.id, templateId))
      .returning();

    if (!tpl) {
      throw new NotificationTemplateNotFoundError(templateId);
    }

    await this.audit.record({
      action: "notification_template.archived",
      actorId: adminUserId,
      actorRole: "admin",
      entityId: templateId,
      entityType: "notification_template",
      metadata: { templateKey: tpl.templateKey },
    });

    return tpl;
  }

  /**
   * Retrieve a template with all its versions.
   */
  public async getTemplate(idOrKey: string) {
    const [tpl] = await this.db
      .select()
      .from(notificationTemplate)
      .where(
        sql`${notificationTemplate.id} = ${idOrKey} OR ${notificationTemplate.templateKey} = ${idOrKey}`,
      )
      .limit(1);

    if (!tpl) {
      throw new NotificationTemplateNotFoundError(idOrKey);
    }

    const versions = await this.db
      .select()
      .from(notificationTemplateVersion)
      .where(eq(notificationTemplateVersion.templateId, tpl.id))
      .orderBy(desc(notificationTemplateVersion.version));

    return {
      ...tpl,
      versions,
      publishedVersion: versions.find((v) => v.status === "PUBLISHED"),
    };
  }

  /**
   * List templates with optional filtering.
   */
  public async listTemplates(filters?: {
    channel?: NotificationChannel;
    eventKey?: string;
    status?: NotificationTemplateStatus;
    category?: NotificationCategory;
  }) {
    const conditions = [];
    if (filters?.channel) conditions.push(eq(notificationTemplate.channel, filters.channel));
    if (filters?.eventKey) conditions.push(eq(notificationTemplate.eventKey, filters.eventKey));
    if (filters?.status) conditions.push(eq(notificationTemplate.status, filters.status));
    if (filters?.category) conditions.push(eq(notificationTemplate.category, filters.category));

    return this.db
      .select()
      .from(notificationTemplate)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(notificationTemplate.createdAt));
  }

  /**
   * Resolve active published version for a given event, channel, and locale.
   */
  public async getActivePublishedVersion(
    eventKey: string,
    channel: NotificationChannel,
    locale = "fa-IR",
  ) {
    const rows = await this.db
      .select({
        template: notificationTemplate,
        version: notificationTemplateVersion,
      })
      .from(notificationTemplate)
      .innerJoin(
        notificationTemplateVersion,
        eq(notificationTemplate.id, notificationTemplateVersion.templateId),
      )
      .where(
        and(
          eq(notificationTemplate.eventKey, eventKey),
          eq(notificationTemplate.channel, channel),
          eq(notificationTemplate.locale, locale),
          eq(notificationTemplate.status, "ACTIVE"),
          eq(notificationTemplateVersion.status, "PUBLISHED"),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }
}

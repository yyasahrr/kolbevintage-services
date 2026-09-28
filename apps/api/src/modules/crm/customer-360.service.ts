import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  accountUser,
  consentEvent,
  CONSENT_PURPOSES,
  payment,
  retailOrder,
  wholesaleAccount,
  wholesaleOrder,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { CrmContactService } from "./crm-contact.service";
import { CrmActivityService } from "./crm-activity.service";
import { CrmTaskService } from "./crm-task.service";

export interface Customer360ReadModel {
  contact: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    city: string | null;
    stage: string;
    assignedAdmin: { id: string; displayName: string | null; email: string } | null;
    tags: Array<{ id: string; key: string; label: string; color: string | null }>;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
  };
  identity: {
    isLinked: boolean;
    accountUser: {
      id: string;
      phone: string | null;
      email: string;
      displayName: string | null;
      role: string;
      status: string;
      createdAt: Date;
    } | null;
    wholesaleAccount: {
      id: string;
      memberName: string | null;
      storeName: string | null;
      phone: string;
      city: string | null;
      status: string;
      createdAt: Date;
    } | null;
  };
  commerce: {
    totalOrdersCount: number;
    completedOrdersCount: number;
    totalSpentRial: bigint;
    refundedAmountRial: bigint;
    netSpentRial: bigint;
    averageOrderValueRial: bigint;
    firstOrderAt: Date | null;
    lastOrderAt: Date | null;
    currency: "IRR";
  };
  recentOrders: Array<{
    id: string;
    orderCode: string;
    type: "wholesale" | "retail";
    status: string;
    totalAmount: bigint;
    currency: string;
    createdAt: Date;
  }>;
  compliance: {
    hasConsentRecord: boolean;
    channels: Record<
      string,
      {
        status: "granted" | "withdrawn" | "not_recorded";
        occurredAt: Date | null;
        source: string | null;
      }
    >;
  };
  timeline: Array<{
    id: string;
    kind: "activity" | "internal_note";
    type: string;
    title: string;
    body: string;
    source: string;
    timestamp: Date;
    actorId: string;
    actorName: string | null;
    metadata: Record<string, unknown>;
  }>;
  openTasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    dueAt: Date | null;
    assigneeName: string | null;
  }>;
}

@Injectable()
export class Customer360Service {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(CrmContactService) private readonly contactService: CrmContactService,
    @Inject(CrmActivityService) private readonly activityService: CrmActivityService,
    @Inject(CrmTaskService) private readonly taskService: CrmTaskService,
  ) {}

  async getCustomer360(contactId: string): Promise<Customer360ReadModel> {
    // 1. Get contact with linked identity & tags
    const contact = await this.contactService.getContact(contactId);

    // 2. Fetch full account user details if linked
    let fullAccountUser: Customer360ReadModel["identity"]["accountUser"] = null;
    let fullWholesaleAccount: Customer360ReadModel["identity"]["wholesaleAccount"] = null;
    const linkedUserId = contact.identityLink?.userId || null;

    if (linkedUserId) {
      const [u] = await this.db
        .select({
          id: accountUser.id,
          phone: accountUser.phone,
          email: accountUser.email,
          displayName: accountUser.displayName,
          role: accountUser.role,
          status: accountUser.status,
          createdAt: accountUser.createdAt,
        })
        .from(accountUser)
        .where(eq(accountUser.id, linkedUserId))
        .limit(1);

      if (u) {
        fullAccountUser = u;
      }

      // Check wholesale account for this user
      const [w] = await this.db
        .select({
          id: wholesaleAccount.id,
          memberName: wholesaleAccount.memberName,
          storeName: wholesaleAccount.storeName,
          phone: wholesaleAccount.phone,
          city: wholesaleAccount.city,
          status: wholesaleAccount.status,
          createdAt: wholesaleAccount.createdAt,
        })
        .from(wholesaleAccount)
        .where(eq(wholesaleAccount.userId, linkedUserId))
        .limit(1);

      if (w) {
        fullWholesaleAccount = w;
      }
    }

    // 3. Dynamically derive commerce metrics from authoritative tables
    let totalOrdersCount = 0;
    let completedOrdersCount = 0;
    let totalSpentRial = 0n;
    let refundedAmountRial = 0n;
    let firstOrderAt: Date | null = null;
    let lastOrderAt: Date | null = null;
    const recentOrders: Customer360ReadModel["recentOrders"] = [];

    if (linkedUserId) {
      // Query wholesale orders
      const wsOrders = await this.db
        .select({
          id: wholesaleOrder.id,
          orderCode: wholesaleOrder.orderCode,
          status: wholesaleOrder.status,
          grandTotal: wholesaleOrder.grandTotal,
          currency: wholesaleOrder.currency,
          createdAt: wholesaleOrder.createdAt,
        })
        .from(wholesaleOrder)
        .where(eq(wholesaleOrder.buyerUserId, linkedUserId))
        .orderBy(desc(wholesaleOrder.createdAt));

      // Query retail orders
      const rtOrders = await this.db
        .select({
          id: retailOrder.id,
          orderCode: retailOrder.orderCode,
          orderStatus: retailOrder.orderStatus,
          paymentStatus: retailOrder.paymentStatus,
          totalAmount: retailOrder.totalAmount,
          currency: retailOrder.currency,
          createdAt: retailOrder.createdAt,
        })
        .from(retailOrder)
        .where(
          or(
            eq(retailOrder.customerId, linkedUserId),
            contact.phone ? eq(retailOrder.phone, contact.phone) : sql`false`,
          ),
        )
        .orderBy(desc(retailOrder.createdAt));

      for (const o of wsOrders) {
        totalOrdersCount++;
        const isCompleted = ["completed", "shipped", "fulfillment", "confirmed"].includes(o.status);
        if (isCompleted) {
          completedOrdersCount++;
        }
        if (o.status !== "cancelled") {
          totalSpentRial += o.grandTotal;
        }

        if (!lastOrderAt || o.createdAt > lastOrderAt) lastOrderAt = o.createdAt;
        if (!firstOrderAt || o.createdAt < firstOrderAt) firstOrderAt = o.createdAt;

        recentOrders.push({
          id: o.id,
          orderCode: o.orderCode,
          type: "wholesale",
          status: o.status,
          totalAmount: o.grandTotal,
          currency: o.currency,
          createdAt: o.createdAt,
        });
      }

      for (const o of rtOrders) {
        totalOrdersCount++;
        const isCompleted = ["delivered", "shipped", "confirmed"].includes(o.orderStatus);
        if (isCompleted) {
          completedOrdersCount++;
        }
        if (o.orderStatus !== "cancelled") {
          totalSpentRial += o.totalAmount;
        }
        if (o.orderStatus === "returned") {
          refundedAmountRial += o.totalAmount;
        }

        if (!lastOrderAt || o.createdAt > lastOrderAt) lastOrderAt = o.createdAt;
        if (!firstOrderAt || o.createdAt < firstOrderAt) firstOrderAt = o.createdAt;

        recentOrders.push({
          id: o.id,
          orderCode: o.orderCode,
          type: "retail",
          status: o.orderStatus,
          totalAmount: o.totalAmount,
          currency: o.currency,
          createdAt: o.createdAt,
        });
      }

      // Sort recent orders descending
      recentOrders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }

    const netSpentRial = totalSpentRial > refundedAmountRial ? totalSpentRial - refundedAmountRial : 0n;
    const averageOrderValueRial =
      completedOrdersCount > 0 ? totalSpentRial / BigInt(completedOrdersCount) : 0n;

    // 4. Compliance & Consent (strictly from compliance domain without fabricating)
    const channels: Customer360ReadModel["compliance"]["channels"] = {};
    let hasConsentRecord = false;

    for (const purpose of CONSENT_PURPOSES) {
      channels[purpose] = {
        status: "not_recorded",
        occurredAt: null,
        source: null,
      };
    }

    if (linkedUserId) {
      const consentRows = await this.db
        .select({
          purpose: consentEvent.purpose,
          eventType: consentEvent.eventType,
          source: consentEvent.source,
          occurredAt: consentEvent.occurredAt,
        })
        .from(consentEvent)
        .where(eq(consentEvent.userId, linkedUserId))
        .orderBy(desc(consentEvent.occurredAt));

      for (const row of consentRows) {
        hasConsentRecord = true;
        // Keep the latest event per purpose
        if (channels[row.purpose]?.status === "not_recorded") {
          channels[row.purpose] = {
            status: row.eventType as "granted" | "withdrawn",
            occurredAt: row.occurredAt,
            source: row.source,
          };
        }
      }
    }

    // 5. Activity timeline & open tasks
    const timeline = await this.activityService.getCombinedTimeline(contactId, 10);
    const tasksRes = await this.taskService.listTasks({
      contactId,
      status: undefined,
      limit: 10,
    });
    const openTasks = tasksRes.items
      .filter((t) => ["OPEN", "IN_PROGRESS"].includes(t.status))
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueAt: t.dueAt,
        assigneeName: t.assigneeName,
      }));

    return {
      contact: {
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        city: contact.city,
        stage: contact.stage,
        assignedAdmin: contact.assignedAdmin,
        tags: contact.tags,
        metadata: (contact.metadata as Record<string, unknown>) || {},
        createdAt: contact.createdAt,
        updatedAt: contact.updatedAt,
      },
      identity: {
        isLinked: !!linkedUserId,
        accountUser: fullAccountUser,
        wholesaleAccount: fullWholesaleAccount,
      },
      commerce: {
        totalOrdersCount,
        completedOrdersCount,
        totalSpentRial,
        refundedAmountRial,
        netSpentRial,
        averageOrderValueRial,
        firstOrderAt,
        lastOrderAt,
        currency: "IRR",
      },
      recentOrders: recentOrders.slice(0, 5),
      compliance: {
        hasConsentRecord,
        channels,
      },
      timeline,
      openTasks,
    };
  }
}

import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import {
  adminRole,
  adminRolePermission,
  adminUserRole,
  accountUser,
} from "@kolbe/database";
import { ADMIN_PERMISSION_ACTIONS } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import { AdminPermissionDeniedError } from "./admin.errors";

export interface CreateRoleInput {
  name: string;
  displayName: string;
  description?: string;
  isSystem?: boolean;
}

@Injectable()
export class AdminRbacService implements OnModuleInit {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  async onModuleInit() {
    await this.ensureSystemRoles();
  }

  private makeId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  }

  async ensureSystemRoles(): Promise<void> {
    try {
      // 1. Super Admin Role
      let [superAdmin] = await this.db
        .select()
        .from(adminRole)
        .where(eq(adminRole.name, "super_admin"))
        .limit(1);

      if (!superAdmin) {
        [superAdmin] = await this.db
          .insert(adminRole)
          .values({
            id: "role_super_admin",
            name: "super_admin",
            displayName: "مدیر ارشد سامانه",
            description: "دسترسی کامل و بدون محدودیت به تمامی بخش‌های کنترل پنل",
            isSystem: true,
          })
          .onConflictDoNothing()
          .returning();
      }

      if (superAdmin) {
        // Ensure all actions are granted to super_admin
        for (const action of ADMIN_PERMISSION_ACTIONS) {
          await this.db
            .insert(adminRolePermission)
            .values({
              id: `perm_${superAdmin.id}_${action.replace(/:/g, "_")}`,
              roleId: superAdmin.id,
              action,
            })
            .onConflictDoNothing();
        }
      }

      // 2. Commercial Ops Role
      let [commOps] = await this.db
        .select()
        .from(adminRole)
        .where(eq(adminRole.name, "commercial_ops"))
        .limit(1);

      if (!commOps) {
        [commOps] = await this.db
          .insert(adminRole)
          .values({
            id: "role_commercial_ops",
            name: "commercial_ops",
            displayName: "عملیات بازرگانی و فروش",
            description: "مدیریت پلن‌ها، اعضا و ایجاد درخواست‌های تایید",
            isSystem: true,
          })
          .onConflictDoNothing()
          .returning();
      }

      if (commOps) {
        const commOpsActions: (typeof ADMIN_PERMISSION_ACTIONS)[number][] = [
          "wholesale:plan:view",
          "wholesale:plan:manage",
          "wholesale:membership:view",
          "wholesale:membership:manage",
          "wholesale:approval:create",
          "wholesale:approval:view",
          "wholesale:settings:view",
          "wholesale:notes:view",
          "wholesale:notes:create",
          "wholesale:control_tower:view",
        ];
        for (const action of commOpsActions) {
          await this.db
            .insert(adminRolePermission)
            .values({
              id: `perm_${commOps.id}_${action.replace(/:/g, "_")}`,
              roleId: commOps.id,
              action,
            })
            .onConflictDoNothing();
        }
      }

      // 3. Approver (Checker) Role
      let [approver] = await this.db
        .select()
        .from(adminRole)
        .where(eq(adminRole.name, "approver"))
        .limit(1);

      if (!approver) {
        [approver] = await this.db
          .insert(adminRole)
          .values({
            id: "role_approver",
            name: "approver",
            displayName: "تاییدکننده عملیات حساس",
            description: "بررسی و صدور تصمیم نهایی بر درخواست‌های دو مرحله‌ای",
            isSystem: true,
          })
          .onConflictDoNothing()
          .returning();
      }

      if (approver) {
        const approverActions: (typeof ADMIN_PERMISSION_ACTIONS)[number][] = [
          "wholesale:approval:view",
          "wholesale:approval:decide",
          "wholesale:plan:view",
          "wholesale:membership:view",
          "wholesale:settings:view",
          "wholesale:notes:view",
          "wholesale:control_tower:view",
        ];
        for (const action of approverActions) {
          await this.db
            .insert(adminRolePermission)
            .values({
              id: `perm_${approver.id}_${action.replace(/:/g, "_")}`,
              roleId: approver.id,
              action,
            })
            .onConflictDoNothing();
        }
      }
    } catch {
      // Non-blocking in case tables are created during runtime tests
    }
  }

  async createRole(input: CreateRoleInput, actorId: string) {
    const roleId = this.makeId("role");
    const [created] = await this.db
      .insert(adminRole)
      .values({
        id: roleId,
        name: input.name,
        displayName: input.displayName,
        description: input.description,
        isSystem: input.isSystem ?? false,
      })
      .returning();

    await this.auditService.record({
      actorId,
      actorRole: "admin",
      action: "admin_role_created",
      entityType: "admin_role",
      entityId: roleId,
      metadata: { name: input.name, displayName: input.displayName },
    });

    return created;
  }

  async assignPermissionsToRole(roleId: string, actions: string[], actorId: string) {
    // Validate role
    const [role] = await this.db
      .select()
      .from(adminRole)
      .where(eq(adminRole.id, roleId))
      .limit(1);

    if (!role) {
      throw new Error(`Admin role with ID '${roleId}' not found`);
    }

    const inserted: any[] = [];
    for (const action of actions) {
      const permId = this.makeId("perm");
      const [res] = await this.db
        .insert(adminRolePermission)
        .values({
          id: permId,
          roleId,
          action,
        })
        .onConflictDoNothing()
        .returning();
      if (res) inserted.push(res);
    }

    await this.auditService.record({
      actorId,
      actorRole: "admin",
      action: "admin_role_permissions_assigned",
      entityType: "admin_role",
      entityId: roleId,
      metadata: { actions },
    });

    return inserted;
  }

  async assignRoleToUser(userId: string, roleId: string, assignedBy: string) {
    const userRoleId = this.makeId("aur");
    const [assignment] = await this.db
      .insert(adminUserRole)
      .values({
        id: userRoleId,
        userId,
        roleId,
        assignedBy,
      })
      .onConflictDoNothing()
      .returning();

    await this.auditService.record({
      actorId: assignedBy,
      actorRole: "admin",
      action: "admin_user_role_assigned",
      entityType: "admin_user_role",
      entityId: userRoleId,
      metadata: { userId, roleId },
    });

    return assignment;
  }

  async revokeRoleFromUser(userId: string, roleId: string, revokedBy: string) {
    await this.db
      .delete(adminUserRole)
      .where(and(eq(adminUserRole.userId, userId), eq(adminUserRole.roleId, roleId)));

    await this.auditService.record({
      actorId: revokedBy,
      actorRole: "admin",
      action: "admin_user_role_revoked",
      entityType: "admin_user_role",
      entityId: `${userId}:${roleId}`,
      metadata: { userId, roleId },
    });
  }

  async getUserPermissions(userId: string): Promise<Set<string>> {
    // 1. Fetch user's assigned roles
    const userRoles = await this.db
      .select({ roleId: adminUserRole.roleId })
      .from(adminUserRole)
      .where(eq(adminUserRole.userId, userId));

    if (userRoles.length === 0) {
      // Check if user has global 'admin' role in accountUser table
      const [user] = await this.db
        .select({ role: accountUser.role })
        .from(accountUser)
        .where(eq(accountUser.id, userId))
        .limit(1);

      // If user is admin in accountUser but has no granular assignments,
      // allow full admin permissions for backward compatibility.
      if (user?.role === "admin") {
        return new Set(ADMIN_PERMISSION_ACTIONS);
      }
      return new Set();
    }

    const roleIds = userRoles.map((r) => r.roleId);
    const perms = await this.db
      .select({ action: adminRolePermission.action })
      .from(adminRolePermission)
      .where(inArray(adminRolePermission.roleId, roleIds));

    return new Set(perms.map((p) => p.action));
  }

  async hasPermission(userId: string, action: string): Promise<boolean> {
    const permissions = await this.getUserPermissions(userId);
    return permissions.has(action);
  }

  async assertPermission(userId: string, action: string): Promise<void> {
    const allowed = await this.hasPermission(userId, action);
    if (!allowed) {
      throw new AdminPermissionDeniedError(action);
    }
  }

  async listRoles() {
    return await this.db.select().from(adminRole);
  }

  async getUserRoles(userId: string) {
    return await this.db
      .select({
        id: adminUserRole.id,
        roleId: adminRole.id,
        roleName: adminRole.name,
        displayName: adminRole.displayName,
        assignedAt: adminUserRole.assignedAt,
      })
      .from(adminUserRole)
      .innerJoin(adminRole, eq(adminRole.id, adminUserRole.roleId))
      .where(eq(adminUserRole.userId, userId));
  }
}

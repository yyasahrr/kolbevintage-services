import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { InternalNotesService } from "./internal-notes.service";
import { AdminPermissionGuard, RequireAdminPermission } from "./admin-rbac.guard";

@Controller("admin/notes")
@Roles("admin")
@UseGuards(AdminPermissionGuard)
export class AdminNotesController {
  constructor(
    @Inject(InternalNotesService) private readonly notesService: InternalNotesService,
  ) {}

  @Post()
  @RequireAdminPermission("wholesale:notes:create")
  async createNote(@Body() body: any, @CurrentUser() user: Claims) {
    const actorId = user.sub;
    const note = await this.notesService.createNote(
      {
        targetType: body.targetType,
        targetId: body.targetId,
        noteText: body.noteText,
        isPinned: body.isPinned,
        metadata: body.metadata,
      },
      actorId,
    );
    return toApiJson({ note });
  }

  @Get()
  @RequireAdminPermission("wholesale:notes:view")
  async listNotes(
    @Query("targetType") targetType: any,
    @Query("targetId") targetId: string,
    @Query("includeArchived") includeArchived?: string,
  ) {
    const isInclude = includeArchived === "true";
    const notes = await this.notesService.getNotesForTarget(targetType, targetId, isInclude);
    return toApiJson({ notes });
  }

  @Patch(":id/pin")
  @RequireAdminPermission("wholesale:notes:create")
  async pinNote(
    @Param("id") id: string,
    @Body() body: { isPinned: boolean },
    @CurrentUser() user: Claims,
  ) {
    const actorId = user.sub;
    const note = await this.notesService.setPin(id, body.isPinned ?? true, actorId);
    return toApiJson({ note });
  }

  @Delete(":id")
  @RequireAdminPermission("wholesale:notes:create")
  async archiveNote(@Param("id") id: string, @CurrentUser() user: Claims) {
    const actorId = user.sub;
    const note = await this.notesService.archiveNote(id, actorId);
    return toApiJson({ note });
  }
}

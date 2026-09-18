import { Controller, Get, Post, Body, Param } from "@nestjs/common";
import { SuppliersService } from "./suppliers.service";

@Controller("suppliers")
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Post()
  async create(@Body() body: { legalName: string; displayName: string }) {
    return this.suppliers.createSupplier(body);
  }

  @Get(":id/members")
  async members(@Param("id") id: string) {
    return this.suppliers.listMembers(id);
  }
}

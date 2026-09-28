import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
} from "@nestjs/common";
import { Public } from "../../common/guards/session.guard";
import { toApiJson } from "../../common/api-json";
import { NotificationReceiptService } from "./notification-receipt.service";

@Controller("notifications/webhooks")
export class NotificationWebhookController {
  constructor(
    @Inject(NotificationReceiptService)
    private readonly receiptService: NotificationReceiptService,
  ) {}

  @Post(":providerKey")
  @Public()
  @HttpCode(200)
  async handleWebhook(
    @Param("providerKey") providerKey: string,
    @Body() body: Record<string, unknown>,
    @Headers("x-signature") signatureHeader?: string,
    @Headers("x-webhook-signature") altSignatureHeader?: string,
  ) {
    const signature = signatureHeader ?? altSignatureHeader ?? "";
    const rawPayload = typeof body === "string" ? body : JSON.stringify(body);

    const result = await this.receiptService.ingestReceipt(
      providerKey,
      rawPayload,
      signature,
    );

    return toApiJson(result);
  }
}

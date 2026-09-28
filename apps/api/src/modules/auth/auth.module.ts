import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

/**
 * ماژول احراز هویت — فاز ۲.
 *
 * مالک جدول‌های `account_user`, `login_attempt`, `user_session`.
 * وضعیت: **live** پس از این فاز — جایگزین مسیرهای `/store/kolbe/auth/*` قدیمی.
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}

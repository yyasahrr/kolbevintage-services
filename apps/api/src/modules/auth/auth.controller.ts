import { Body, Controller, Get, Post, Req, Res, UseGuards, Inject } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { TotpVerifyDto } from "./dto/totp.dto";
import { Public, Roles, CurrentUser, type RequestWithClaims } from "../../common/guards/session.guard";
import { SessionGuard } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { RateLimit } from "../../common/rate-limit/rate-limit.decorator";
import { CONFIG_TOKEN, type AppConfig } from "../../config/configuration";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  private exposeCompatibilityToken(req: Request, res: Response, token: string): void {
    const expected = this.config.internalApiToken?.trim();
    const provided = String(req.headers["x-kolbe-internal-token"] ?? "").trim();
    if (expected && provided === expected) res.setHeader("X-Kolbe-Session-Token", token);
  }

  @Post("register")
  @Public()
  @RateLimit({ limit: 5, windowSeconds: 60, scope: "ip", keyPrefix: "auth:register" })
  @ApiOperation({ summary: "ثبت‌نام مشتری" })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip ?? null;
    const requesterRole = (req as RequestWithClaims).claims?.role ?? null;

    const { user, token } = await this.auth.register({
      email: dto.email,
      password: dto.password,
      name: dto.name,
      phone: dto.phone,
      role: dto.role,
      requesterRole,
      ip,
    });

    res.setHeader("Set-Cookie", this.auth.cookie(token));
    this.exposeCompatibilityToken(req, res, token);
    return { user: { id: user.id, email: user.email, role: user.role, name: user.displayName, phone: user.phone } };
  }

  @Post("login")
  @Public()
  @RateLimit({ limit: 5, windowSeconds: 60, scope: "ip", keyPrefix: "auth:login" })
  @ApiOperation({ summary: "ورود" })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip ?? null;
    const userAgent = String(req.headers["user-agent"] ?? "");

    const { user, token, supplierContext } = await this.auth.login({
      email: dto.email,
      password: dto.password,
      role: dto.role,
      totpCode: (dto as any).totpCode ?? null,
      ip,
      userAgent,
    });

    res.setHeader("Set-Cookie", this.auth.cookie(token));
    this.exposeCompatibilityToken(req, res, token);
    return {
      user: { id: user.id, email: user.email, role: user.role, name: user.displayName, phone: user.phone },
      supplier: supplierContext ?? undefined,
    };
  }

  @Post("logout")
  @ApiOperation({ summary: "خروج و ابطال توکن" })
  async logout(@CurrentUser() claims: Claims, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(claims.sub);
    res.setHeader("Set-Cookie", this.auth.clearCookie());
    return { ok: true };
  }

  @Get("me")
  @ApiOperation({ summary: "اطلاعات کاربر جاری" })
  async me(@CurrentUser() claims: Claims) {
    const user = await this.auth.me(claims.sub);
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.displayName,
      phone: user.phone,
      totpEnabled: (user as any).totpEnabled ?? false,
      supplier: (user as any).supplierContext ?? null,
    };
  }

  // ── TOTP ────────────────────────────────────────────────────────────────
  @Post("totp/enroll")
  @ApiOperation({ summary: "شروع ثبت‌نام دومرحله‌ای — تولید راز و QR URL" })
  async enrollTotp(@CurrentUser() claims: Claims) {
    const user = await this.auth.me(claims.sub);
    const { secret, otpauthUrl } = await this.auth.enrollTotp(claims.sub, user.email);
    // راز فقط یک‌بار نمایش داده می‌شود؛ کلاینت باید QR را نشان دهد
    return { secret, otpauthUrl };
  }

  @Post("totp/verify")
  @RateLimit({ limit: 5, windowSeconds: 60, scope: "user", keyPrefix: "auth:totp_verify" })
  @ApiOperation({ summary: "تأیید کد TOTP و فعال‌سازی" })
  async verifyTotp(@CurrentUser() claims: Claims, @Body() dto: TotpVerifyDto) {
    await this.auth.verifyTotp(claims.sub, dto.code);
    return { ok: true, enabled: true };
  }

  @Post("totp/disable")
  @ApiOperation({ summary: "غیرفعال‌سازی TOTP" })
  async disableTotp(@CurrentUser() claims: Claims, @Body() dto: TotpVerifyDto) {
    await this.auth.disableTotp(claims.sub, dto.code);
    return { ok: true, enabled: false };
  }

  // مسیرهای سازگار با لگاسی `/store/kolbe/*` — در دورهٔ گذار هر دو کار می‌کنند
  @Post("supplier/login")
  @Public()
  @RateLimit({ limit: 5, windowSeconds: 60, scope: "ip", keyPrefix: "auth:supplier_login" })
  @ApiOperation({ summary: "ورود تأمین‌کننده (سازگار با لگاسی)" })
  async supplierLogin(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip ?? null;
    const userAgent = String(req.headers["user-agent"] ?? "");

    const { user, token, supplierContext } = await this.auth.login({
      email: dto.email,
      password: dto.password,
      role: "supplier",
      totpCode: (dto as any).totpCode ?? null,
      ip,
      userAgent,
    });

    if (!supplierContext) {
      // اگر کاربر تأمین‌کننده است ولی عضو هیچ تأمین‌کننده‌ای نیست
      // همان خطای دسترسی غیرفعال را برمی‌گردانیم تا با لگاسی سازگار باشد
      throw new Error("SUPPLIER_ACCESS_INACTIVE");
    }

    res.setHeader("Set-Cookie", this.auth.cookie(token));
    this.exposeCompatibilityToken(req, res, token);
    const responseBody: Record<string, unknown> = {
      user: { id: user.id, email: user.email, role: user.role },
      supplier: supplierContext,
    };
    // در تولید توکن هرگز در بدنه افشا نمی‌شود؛ در صورت نیاز به سازگاری با لگاسی فقط در غیرتولید فعال می‌شود
    if (this.config.env !== "production" && process.env.LEGACY_AUTH_EXPOSE_TOKEN_BODY === "true") {
      responseBody.token = token;
    }
    return responseBody;
  }
}

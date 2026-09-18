import { IsEmail, IsOptional, IsString, MinLength, IsIn } from "class-validator";

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  @IsOptional()
  @IsIn(["customer", "vip", "supplier", "admin"])
  role?: string;

  @IsOptional()
  @IsString()
  totpCode?: string;
}

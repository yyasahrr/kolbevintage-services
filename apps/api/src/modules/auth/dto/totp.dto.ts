import { IsOptional, IsString } from "class-validator";

export class TotpVerifyDto {
  @IsString()
  code!: string;
}

export class TotpDisableDto {
  @IsOptional()
  @IsString()
  code?: string;
}

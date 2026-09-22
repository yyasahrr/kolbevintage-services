import { DomainError } from "@kolbe/shared";

/**
 * Phase 5.9-A — customer account contract. Status-code conventions follow
 * the retail precedent: structural input failures are 400, semantic
 * rejections 422, conflicts 409, ownership 403, missing rows 404.
 */
export class CustomerAccountDomainError extends DomainError {
  constructor(code: string, message: string) {
    let status = 400;
    if (code === "CUSTOMER_ADDRESS_LIMIT_REACHED" || code === "CUSTOMER_ADDRESS_DEFAULT_REQUIRED") {
      status = 422;
    } else if (code === "CUSTOMER_ADDRESS_VERSION_CONFLICT" || code === "CUSTOMER_ADDRESS_DEFAULT_CONFLICT") {
      status = 409;
    } else if (code === "CUSTOMER_PROFILE_FORBIDDEN" || code === "CUSTOMER_ADDRESS_FORBIDDEN") {
      status = 403;
    } else if (code === "CUSTOMER_PROFILE_NOT_FOUND" || code === "CUSTOMER_ADDRESS_NOT_FOUND") {
      status = 404;
    }
    super(status, code, message);
    this.name = "CustomerAccountDomainError";
  }
}

export type CustomerAddressView = {
  id: string;
  label: string;
  recipientName: string;
  recipientPhone: string;
  province: string;
  city: string;
  addressLine: string;
  plaque: string | null;
  unit: string | null;
  postalCode: string;
  isDefault: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateCustomerAddressInput = {
  label?: unknown;
  recipientName?: unknown;
  recipientPhone?: unknown;
  province?: unknown;
  city?: unknown;
  addressLine?: unknown;
  plaque?: unknown;
  unit?: unknown;
  postalCode?: unknown;
  isDefault?: unknown;
};

export type UpdateCustomerAddressInput = CreateCustomerAddressInput & {
  version?: unknown;
};

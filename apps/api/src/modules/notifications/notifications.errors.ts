import { DomainError } from "@kolbe/shared";

export class NotificationEventNotFoundError extends DomainError {
  constructor(eventId: string) {
    super(404, "NOTIFICATION_EVENT_NOT_FOUND", `Notification event '${eventId}' was not found.`);
  }
}

export class NotificationEventDuplicateError extends DomainError {
  constructor(sourceDomain: string, sourceEventId: string) {
    super(409, "NOTIFICATION_EVENT_DUPLICATE", `Duplicate notification event from '${sourceDomain}' with id '${sourceEventId}'.`);
  }
}

export class NotificationTemplateNotFoundError extends DomainError {
  constructor(identifier: string) {
    super(404, "NOTIFICATION_TEMPLATE_NOT_FOUND", `Notification template '${identifier}' was not found.`);
  }
}

export class NotificationTemplateVersionNotFoundError extends DomainError {
  constructor(templateId: string, version: number) {
    super(404, "NOTIFICATION_TEMPLATE_VERSION_NOT_FOUND", `Version ${version} of template '${templateId}' was not found.`);
  }
}

export class NotificationTemplatePublishedImmutableError extends DomainError {
  constructor(templateId: string, version: number) {
    super(409, "NOTIFICATION_TEMPLATE_PUBLISHED_IMMUTABLE", `Template version ${version} of '${templateId}' is published and historically immutable. Create a new draft version to edit.`);
  }
}

export class NotificationTemplateValidationError extends DomainError {
  constructor(message: string) {
    super(400, "NOTIFICATION_TEMPLATE_VALIDATION_ERROR", message);
  }
}

export class NotificationTemplateRenderError extends DomainError {
  constructor(message: string) {
    super(400, "NOTIFICATION_TEMPLATE_RENDER_ERROR", message);
  }
}

export class NotificationPreferenceForbiddenError extends DomainError {
  constructor(message: string) {
    super(403, "NOTIFICATION_PREFERENCE_FORBIDDEN", message);
  }
}

export class NotificationMarketingConsentRequiredError extends DomainError {
  constructor(recipientId: string) {
    super(403, "NOTIFICATION_MARKETING_CONSENT_REQUIRED", `Marketing notification rejected: recipient '${recipientId}' lacks active compliance consent.`);
  }
}

export class NotificationRecipientNotFoundError extends DomainError {
  constructor(recipientType: string, recipientId: string) {
    super(404, "NOTIFICATION_RECIPIENT_NOT_FOUND", `Recipient '${recipientId}' of type '${recipientType}' was not found in authoritative domain records.`);
  }
}

export class NotificationSensitivePayloadError extends DomainError {
  constructor(field: string) {
    super(400, "NOTIFICATION_SENSITIVE_PAYLOAD_REJECTED", `Notification payload rejected: sensitive field '${field}' detected.`);
  }
}

export class NotificationDeliveryNotFoundError extends DomainError {
  constructor(deliveryId: string) {
    super(404, "NOTIFICATION_DELIVERY_NOT_FOUND", `Delivery '${deliveryId}' was not found in notification outbox.`);
  }
}

export class NotificationProviderSignatureError extends DomainError {
  constructor(providerKey: string) {
    super(401, "NOTIFICATION_PROVIDER_SIGNATURE_INVALID", `Webhook signature verification failed for provider '${providerKey}'.`);
  }
}

export class NotificationProviderUnavailableError extends DomainError {
  constructor(providerKey: string, reason?: string) {
    super(503, "NOTIFICATION_PROVIDER_UNAVAILABLE", `Provider '${providerKey}' is unavailable${reason ? `: ${reason}` : ""}.`);
  }
}

export class NotificationProviderConfigurationError extends DomainError {
  constructor(message: string) {
    super(500, "NOTIFICATION_PROVIDER_CONFIGURATION_ERROR", message);
  }
}

export class NotificationDestinationInvalidError extends DomainError {
  constructor(destination: string, reason?: string) {
    super(400, "NOTIFICATION_DESTINATION_INVALID", `Invalid destination '${destination}'${reason ? `: ${reason}` : ""}.`);
  }
}


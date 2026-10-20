import { isBusinessScopedUserId } from '@kapso/whatsapp-cloud-api';

/**
 * Addresses a send to a contact. Phone numbers get a leading "+", because without
 * it Meta prefixes the business number's country code. Business-scoped user IDs
 * (contacts that only shared a username) go in `recipient` instead of `to`.
 */
export function recipientFields(value: string): { to: string } | { recipient: string } {
  const trimmed = value.trim();
  if (isBusinessScopedUserId(trimmed)) return { recipient: trimmed };

  const digits = trimmed.replace(/\D/g, '');
  return { to: digits ? `+${digits}` : trimmed };
}

/**
 * Human-readable explanations for WhatsApp Cloud API error codes, shared by the
 * API routes (send failures) and the UI (failed message statuses).
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
 */
const ERROR_MESSAGES: Record<number, string> = {
  0: 'WhatsApp could not authenticate this request.',
  100: 'WhatsApp rejected a parameter in this message.',
  190: 'The WhatsApp access token expired or is invalid.',
  4: 'The app hit its API rate limit. Try again shortly.',
  368: 'The WhatsApp Business Account is restricted or disabled for violating a platform policy.',
  80007: 'The WhatsApp Business Account hit its rate limit. Try again shortly.',
  130429: 'The phone number hit its message throughput limit. Try again in a moment.',
  130472: "WhatsApp didn't deliver this message because the contact is part of an experiment.",
  130497: "This business can't message users in the contact's country.",
  131000: 'WhatsApp had an unexpected error. Try again.',
  131005: 'Access denied for this phone number or WhatsApp Business Account.',
  131008: 'A required parameter is missing.',
  131009: 'A parameter value is invalid, or the message you reacted to is too old, deleted, or a reaction.',
  131016: 'WhatsApp is temporarily unavailable. Try again shortly.',
  131021: "You can't message your own business number.",
  131026: "The message couldn't be delivered. The contact may not use WhatsApp, may be on an old app version, or hasn't accepted the latest terms.",
  131031: 'The WhatsApp Business Account is locked.',
  131042: 'There is a payment problem on the WhatsApp Business Account.',
  131045: 'The phone number is not registered with WhatsApp Cloud API.',
  131037: 'This number needs an approved display name before it can send messages.',
  131047: 'More than 24 hours have passed since the contact last wrote. Send a template to reopen the conversation.',
  131048: "Messages are being limited as spam. Check the number's quality rating.",
  131049: 'WhatsApp chose not to deliver this marketing message to keep engagement healthy. Try again later.',
  131050: 'The contact stopped receiving marketing messages from this business.',
  131051: "WhatsApp doesn't support this message type.",
  131052: "The contact's media couldn't be downloaded.",
  131053: "The media couldn't be uploaded. Check the file type and size.",
  131056: 'Too many messages to this contact in a short time. Wait a moment before sending again.',
  131057: 'The WhatsApp Business Account is in maintenance mode.',
  131060: 'This message is unavailable.',
  131063: 'Marketing templates are disabled for this account on Cloud API.',
  131064: 'The daily limit for this template category was reached.',
  132000: "The template's parameter count doesn't match its definition.",
  132001: "The template doesn't exist in this language, or isn't approved yet.",
  132005: 'A template parameter makes the message too long.',
  132007: "The template content breaks WhatsApp's policy.",
  132012: "A template parameter doesn't match the expected format.",
  132015: 'This template is paused because of low quality.',
  132016: 'This template is disabled because of low quality.',
  132068: 'The template flow is blocked.',
  132069: 'The template flow is throttled.',
  133010: 'The phone number is not registered with WhatsApp.',
  135000: 'WhatsApp rejected the message because of an unknown parameter error.',
};

export function describeWhatsAppError(code?: number | null, fallback?: string | null): string {
  if (typeof code === 'number' && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  return fallback?.trim() || 'WhatsApp rejected the message.';
}

/** The message needs a template because the 24-hour customer service window is closed. */
export function isWindowClosedError(code?: number | null): boolean {
  return code === 131047;
}

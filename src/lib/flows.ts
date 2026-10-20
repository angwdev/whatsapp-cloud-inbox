/** Shared between the flow routes and the send-flow dialog. */
export type FlowStatus = 'DRAFT' | 'PUBLISHED' | 'DEPRECATED' | 'BLOCKED' | 'THROTTLED';

export type FlowSummary = {
  id: string;
  name: string;
  status: FlowStatus | string;
  categories: string[];
};

export const FLOW_LIMITS = {
  cta: 30,
  body: 1024,
  header: 60,
  footer: 60,
} as const;

/** Flows a message can open. Drafts need `mode: "draft"`; deprecated and blocked flows can't be sent. */
export function isSendableFlowStatus(status: string): boolean {
  return status === 'PUBLISHED' || status === 'THROTTLED' || status === 'DRAFT';
}

export const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;

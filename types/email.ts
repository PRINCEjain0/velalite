export interface ParsedEmail {
  messageId: string;
  threadId?: string;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  bodyText: string;
}

export type EmailIntent =
  | 'interview_interest'
  | 'scheduling_request'
  | 'confirm_slot'
  | 'decline'
  | 'other';


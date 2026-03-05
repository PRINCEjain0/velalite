declare module '@prisma/client' {
  export type Thread = {
    id: string;
    email_thread_id: string;
    organizer_email: string;
    guest_email: string;
    status: string;
    created_at: Date;
  };

  export type ProposedSlot = {
    id: string;
    thread_id: string;
    start_time: Date;
    end_time: Date;
    status: string;
  };

  export type Meeting = {
    id: string;
    thread_id: string;
    calendar_event_id: string | null;
    scheduled_time: Date;
    status: string;
  };

  export class PrismaClient {
    constructor(options?: { log?: string[] });
    thread: {
      findFirst(args: {
        where: Record<string, unknown>;
        orderBy?: Record<string, 'asc' | 'desc'>;
      }): Promise<Thread | null>;
      create(args: { data: Record<string, unknown> }): Promise<Thread>;
      update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<Thread>;
    };
    proposedSlot: {
      createMany(args: { data: unknown[] }): Promise<{ count: number }>;
      findMany(args: {
        where: { thread_id: string; status?: string };
        orderBy?: { start_time: 'asc' | 'desc' };
      }): Promise<ProposedSlot[]>;
      update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<ProposedSlot>;
    };
    meeting: {
      create(args: { data: Record<string, unknown> }): Promise<Meeting>;
      findFirst(args: {
        where: Record<string, unknown>;
        orderBy?: Record<string, 'asc' | 'desc'>;
      }): Promise<Meeting | null>;
      update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<Meeting>;
    };
  }
}

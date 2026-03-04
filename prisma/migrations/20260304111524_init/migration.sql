-- CreateEnum
CREATE TYPE "ThreadStatus" AS ENUM ('NEW_THREAD', 'SLOTS_PROPOSED', 'AWAITING_CONFIRMATION', 'MEETING_SCHEDULED');

-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Thread" (
    "id" TEXT NOT NULL,
    "email_thread_id" TEXT NOT NULL,
    "organizer_email" TEXT NOT NULL,
    "guest_email" TEXT NOT NULL,
    "status" "ThreadStatus" NOT NULL DEFAULT 'NEW_THREAD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposedSlot" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "status" "SlotStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "ProposedSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "calendar_event_id" TEXT,
    "scheduled_time" TIMESTAMP(3) NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ProposedSlot" ADD CONSTRAINT "ProposedSlot_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "Thread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "Thread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

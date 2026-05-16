-- CreateTable
CREATE TABLE "sync_events" (
    "id" UUID NOT NULL,
    "calendar_account_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "google_event_id" TEXT NOT NULL,
    "etag" TEXT,
    "pushed_hash" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_events_task_id_idx" ON "sync_events"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_events_calendar_account_id_task_id_key" ON "sync_events"("calendar_account_id", "task_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_events_calendar_account_id_google_event_id_key" ON "sync_events"("calendar_account_id", "google_event_id");

-- AddForeignKey
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_calendar_account_id_fkey" FOREIGN KEY ("calendar_account_id") REFERENCES "calendar_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;


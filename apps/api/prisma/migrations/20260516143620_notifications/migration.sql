-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notify_digest" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_email" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_reminders" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_web_push" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "task_id" UUID,
    "type" VARCHAR(32) NOT NULL,
    "channel" VARCHAR(16) NOT NULL,
    "payload" JSONB NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_scheduled_for_sent_at_idx" ON "notifications"("scheduled_for", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_task_id_type_scheduled_for_key" ON "notifications"("task_id", "type", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


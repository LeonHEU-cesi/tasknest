-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "occurrence_date" TIMESTAMP(3),
ADD COLUMN     "recurrence_exception" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recurrence_rule_id" UUID;

-- CreateTable
CREATE TABLE "recurrence_rules" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "rrule" TEXT NOT NULL,
    "end_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurrence_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurrence_rules_owner_id_idx" ON "recurrence_rules"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_recurrence_rule_id_occurrence_date_key" ON "tasks"("recurrence_rule_id", "occurrence_date");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_rule_id_fkey" FOREIGN KEY ("recurrence_rule_id") REFERENCES "recurrence_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence_rules" ADD CONSTRAINT "recurrence_rules_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "users" ADD COLUMN     "ics_feed_token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_ics_feed_token_key" ON "users"("ics_feed_token");


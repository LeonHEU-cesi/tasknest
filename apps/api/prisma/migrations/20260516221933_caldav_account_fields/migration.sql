-- AlterTable
ALTER TABLE "calendar_accounts" ADD COLUMN     "caldav_kind" VARCHAR(16),
ADD COLUMN     "caldav_password" TEXT,
ADD COLUMN     "caldav_url" TEXT,
ADD COLUMN     "caldav_username" TEXT;


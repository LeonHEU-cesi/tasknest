-- AlterTable
ALTER TABLE "two_factors" ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "two_factors_secret_idx" ON "two_factors"("secret");

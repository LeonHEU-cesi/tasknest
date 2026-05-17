-- CreateTable
CREATE TABLE "project_shares" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "invited_email" VARCHAR(254) NOT NULL,
    "role" VARCHAR(16) NOT NULL DEFAULT 'viewer',
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "token" TEXT NOT NULL,
    "invited_by_id" UUID NOT NULL,
    "user_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_shares_token_key" ON "project_shares"("token");

-- CreateIndex
CREATE INDEX "project_shares_user_id_status_idx" ON "project_shares"("user_id", "status");

-- CreateIndex
CREATE INDEX "project_shares_project_id_status_idx" ON "project_shares"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "project_shares_project_id_invited_email_key" ON "project_shares"("project_id", "invited_email");

-- AddForeignKey
ALTER TABLE "project_shares" ADD CONSTRAINT "project_shares_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_shares" ADD CONSTRAINT "project_shares_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_shares" ADD CONSTRAINT "project_shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateIndex
CREATE INDEX "tasks_title_idx" ON "tasks" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "tasks_description_idx" ON "tasks" USING GIN ("description" gin_trgm_ops);

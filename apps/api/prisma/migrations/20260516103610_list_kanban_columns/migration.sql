-- AlterTable
ALTER TABLE "lists" ADD COLUMN     "kanban_columns" TEXT[] DEFAULT ARRAY['todo', 'doing', 'done', 'postponed']::TEXT[];

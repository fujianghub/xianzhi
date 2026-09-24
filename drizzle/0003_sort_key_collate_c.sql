-- fractional-indexing 的键按 ASCII 字节序比较（'Zz' < 'a0'），库默认排序规则 en_US.utf8 大小写不敏感，
-- 会把 'Zz' 排到小写键之后，拖到最前的空间 / 任务实际落到末尾（debug/2026-09-24-sort-key-collation）。
-- 列级 COLLATE "C" 让 ORDER BY 与 > / < 比较都按字节序；tasks_space_status_sort_idx 随类型变更自动重建。
ALTER TABLE "spaces" ALTER COLUMN "sort_key" TYPE text COLLATE "C";--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "sort_key" TYPE text COLLATE "C";

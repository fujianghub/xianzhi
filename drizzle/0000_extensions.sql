-- 扩展（ADR-0001 §4.2 §4.3）：pg_trgm 模糊兜底、vector 二期语义检索。各库首次迁移执行。
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

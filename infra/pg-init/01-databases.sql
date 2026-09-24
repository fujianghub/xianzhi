-- 首次初始化 PG 数据卷时执行（05 §2 四库）：xz 由 POSTGRES_DB 创建，这里补其余三库。
-- 扩展（pg_trgm / vector）由 drizzle 迁移 0000 在各库内 CREATE EXTENSION，不在此做。
CREATE DATABASE xz_test   OWNER xz;
CREATE DATABASE xz_e2e    OWNER xz;
CREATE DATABASE xz_verify OWNER xz;

-- Role nhóm cho người dùng Postgres trên Cloud SQL (spec 004, kế thừa từ spec 003).
-- Idempotent: chạy lại không lỗi.
-- Chạy sau runbook A5.4 (role app đã có và `GRANT a2matex TO postgres` đã chạy, vì các
-- lệnh ALTER DEFAULT PRIVILEGES FOR ROLE a2matex đòi người chạy là thành viên của a2matex):
--   - Cloud SQL Studio: đăng nhập database a2matex bằng user postgres, dán toàn bộ file, Run.
--   - Hoặc qua Auth Proxy: psql "postgresql://postgres@127.0.0.1:5433/a2matex" -v ON_ERROR_STOP=1 -f deploy/postgres/roles.sql
-- Role từng dev tạo bằng CREATE ROLE ... IN ROLE db_readonly (runbook B, "Thêm và xoá người").
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'db_readonly') THEN
    CREATE ROLE db_readonly NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'db_readwrite') THEN
    CREATE ROLE db_readwrite NOLOGIN;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE a2matex TO db_readonly, db_readwrite;
GRANT USAGE ON SCHEMA public TO db_readonly, db_readwrite;

-- Bảng và sequence đang có.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO db_readonly;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO db_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO db_readwrite;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO db_readwrite;

-- Bảng và sequence do migration tạo về sau (migration chạy bằng role a2matex).
ALTER DEFAULT PRIVILEGES FOR ROLE a2matex IN SCHEMA public
  GRANT SELECT ON TABLES TO db_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE a2matex IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO db_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE a2matex IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO db_readwrite;
ALTER DEFAULT PRIVILEGES FOR ROLE a2matex IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO db_readwrite;

COMMIT;

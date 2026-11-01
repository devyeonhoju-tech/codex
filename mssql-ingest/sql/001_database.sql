-- Applied against master. Idempotent.
-- Recovery SIMPLE keeps the log from growing without bound on this single-node
-- benchmark. Commits are still durable: DELAYED_DURABILITY stays DISABLED.
-- READ_COMMITTED_SNAPSHOT lets the post-run COUNT run without blocking writers.

IF DB_ID(N'ingest') IS NULL
BEGIN
    CREATE DATABASE ingest;
END
GO

IF (SELECT recovery_model_desc FROM sys.databases WHERE name = N'ingest') <> N'SIMPLE'
    ALTER DATABASE ingest SET RECOVERY SIMPLE;
GO

IF (SELECT delayed_durability_desc FROM sys.databases WHERE name = N'ingest') <> N'DISABLED'
    ALTER DATABASE ingest SET DELAYED_DURABILITY = DISABLED;
GO

IF (SELECT is_read_committed_snapshot_on FROM sys.databases WHERE name = N'ingest') <> 1
    ALTER DATABASE ingest SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;
GO

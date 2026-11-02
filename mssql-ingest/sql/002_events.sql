-- Applied against the ingest database.
-- vantr is the payment VAN transaction id. The real VAN key (for example an
-- approval number plus a date) has to be mapped into this one string by the
-- sender. The column is NVARCHAR(128). That length is an assumption until the
-- VAN publishes the real maximum.
--
-- The unique index uses IGNORE_DUP_KEY so a resend, or a race between two
-- writers, does not abort the other rows in the statement. A primary key
-- cannot carry IGNORE_DUP_KEY, so the unique index is the key.

IF OBJECT_ID(N'dbo.ingest_events', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.ingest_events', N'vantr') IS NULL
BEGIN
    DROP TABLE dbo.ingest_events;
END
GO

IF OBJECT_ID(N'dbo.ingest_events', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ingest_events (
        vantr NVARCHAR(128) NOT NULL,
        source_id NVARCHAR(128) NOT NULL,
        event_timestamp DATETIME2(3) NOT NULL,
        payload NVARCHAR(1024) NOT NULL,
        received_at DATETIME2(3) NOT NULL
            CONSTRAINT DF_ingest_events_received_at DEFAULT (SYSUTCDATETIME())
    );

    CREATE UNIQUE NONCLUSTERED INDEX UX_ingest_events_vantr
        ON dbo.ingest_events (vantr)
        WITH (IGNORE_DUP_KEY = ON);
END
GO

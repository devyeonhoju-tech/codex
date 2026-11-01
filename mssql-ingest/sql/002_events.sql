-- Applied against the ingest database.
-- Heap plus a nonclustered primary key: client GUIDs are random, so a clustered
-- key on id would scatter inserts. The key still rejects duplicate ids.

IF OBJECT_ID(N'dbo.ingest_events', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ingest_events (
        id UNIQUEIDENTIFIER NOT NULL,
        source_id NVARCHAR(128) NOT NULL,
        event_timestamp DATETIME2(3) NOT NULL,
        payload NVARCHAR(1024) NOT NULL,
        received_at DATETIME2(3) NOT NULL
            CONSTRAINT DF_ingest_events_received_at DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_ingest_events PRIMARY KEY NONCLUSTERED (id)
    );
END
GO

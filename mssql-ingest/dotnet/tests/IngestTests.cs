using MssqlIngest;
using Xunit;

namespace MssqlIngest.Tests;

public class IngestTests
{
    [Fact]
    public void AcceptsASmallEvent()
    {
        var ev = Sample("hello");
        Assert.True(IngestValidation.TryValidate(ev, out var error), error);
    }

    [Fact]
    public void RejectsAPayloadOver1024Characters()
    {
        var ev = Sample(new string('a', 1025));
        Assert.False(IngestValidation.TryValidate(ev, out var error));
        Assert.Equal("payload_too_large", error);
    }

    [Fact]
    public void RejectsAnEmptyGuid()
    {
        var ev = Sample("x");
        ev.Id = Guid.Empty;
        Assert.False(IngestValidation.TryValidate(ev, out var error));
        Assert.Equal("invalid_id", error);
    }

    [Fact]
    public void GoSplitsBatches()
    {
        var batches = Schema.SplitBatches("SELECT 1\nGO\nSELECT 2\n").ToArray();
        Assert.Equal(["SELECT 1", "SELECT 2"], batches);
    }

    [Fact]
    public async Task FullQueueReturnsRejectedWhileABatchIsFlushing()
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var options = new IngestOptions
        {
            Mode = WriteMode.Batch,
            BatchSize = 1,
            FlushMilliseconds = 1000,
            Writers = 1,
            QueueCapacity = 1,
        };
        var writer = new BatchIngestWriter(options, new IngestCounters(), async (_, _) =>
        {
            entered.TrySetResult();
            await release.Task.ConfigureAwait(false);
        });
        await writer.StartAsync(CancellationToken.None);
        try
        {
            Assert.True(writer.TrySubmit(Sample("a"), out var first));
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(2));
            Assert.True(writer.TrySubmit(Sample("b"), out var second));
            Assert.False(writer.TrySubmit(Sample("c"), out _));
            release.TrySetResult();
            Assert.Equal(WriteResult.Committed, await first.WaitAsync(TimeSpan.FromSeconds(2)));
            Assert.Equal(WriteResult.Committed, await second.WaitAsync(TimeSpan.FromSeconds(2)));
        }
        finally
        {
            release.TrySetResult();
            await writer.StopAsync(CancellationToken.None);
        }
    }

    private static IngestEvent Sample(string payload) => new()
    {
        Id = Guid.NewGuid(),
        SourceId = "device-1",
        Timestamp = DateTimeOffset.Parse("2026-11-01T15:34:00Z"),
        Payload = payload,
    };
}

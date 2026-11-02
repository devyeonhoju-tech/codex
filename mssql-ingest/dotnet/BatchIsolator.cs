namespace MssqlIngest;

/// <summary>
/// Inserts a batch so one bad row does not decide the others.
/// A range that commits, including rows the unique index ignored as duplicates,
/// is success. A range that fails for bad data is split. A single row that
/// fails is success when that vantr is already committed, and a failure otherwise.
/// A broken connection or a timeout fails the range without further splits.
/// </summary>
public static class BatchIsolator
{
    public static async Task<WriteResult[]> IsolateAsync(
        int count,
        Func<int, int, CancellationToken, Task> insertRange,
        Func<int, CancellationToken, Task<bool>> isCommitted,
        Func<Exception, bool> isFatal,
        CancellationToken cancellationToken)
    {
        var results = new WriteResult[count];
        if (count == 0)
        {
            return results;
        }

        await IsolateRangeAsync(
            0,
            count,
            results,
            insertRange,
            isCommitted,
            isFatal,
            cancellationToken).ConfigureAwait(false);
        return results;
    }

    private static async Task IsolateRangeAsync(
        int start,
        int count,
        WriteResult[] results,
        Func<int, int, CancellationToken, Task> insertRange,
        Func<int, CancellationToken, Task<bool>> isCommitted,
        Func<Exception, bool> isFatal,
        CancellationToken cancellationToken)
    {
        try
        {
            await insertRange(start, count, cancellationToken).ConfigureAwait(false);
            for (var i = start; i < start + count; i++)
            {
                results[i] = WriteResult.Committed;
            }
        }
        catch (Exception ex) when (isFatal(ex))
        {
            FailRange(results, start, count);
        }
        catch (Exception)
        {
            if (count == 1)
            {
                var committed = false;
                try
                {
                    committed = await isCommitted(start, cancellationToken).ConfigureAwait(false);
                }
                catch (Exception)
                {
                    committed = false;
                }

                results[start] = committed ? WriteResult.Committed : WriteResult.Failed;
                return;
            }

            var mid = count / 2;
            await IsolateRangeAsync(start, mid, results, insertRange, isCommitted, isFatal, cancellationToken)
                .ConfigureAwait(false);
            await IsolateRangeAsync(start + mid, count - mid, results, insertRange, isCommitted, isFatal, cancellationToken)
                .ConfigureAwait(false);
        }
    }

    private static void FailRange(WriteResult[] results, int start, int count)
    {
        for (var i = start; i < start + count; i++)
        {
            results[i] = WriteResult.Failed;
        }
    }
}

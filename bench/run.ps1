# Build both services, prove they interoperate, then load-test them.
# Windows PowerShell 5.1+ or PowerShell 7. CPU affinity is not applied here;
# bench/run.sh pins cores on Linux. Resource counters in crypto-bench are
# collected only on Linux (/proc); on Windows the table shows n/a for CPU and RSS.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$env:DOTNET_CLI_TELEMETRY_OPTOUT = "1"
$env:DOTNET_NOLOGO = "1"
$env:ASPNETCORE_ENVIRONMENT = "Production"
$env:RUST_LOG = "warn"
$env:BENCH_AES_KEY = (Get-Content -Raw "$Root\bench\testdata\bench_key.hex").Trim()

$Concurrency = if ($env:CONCURRENCY) { $env:CONCURRENCY } else { "32" }
$Warmup = if ($env:WARMUP_SECS) { $env:WARMUP_SECS } else { "5" }
$Duration = if ($env:DURATION_SECS) { $env:DURATION_SECS } else { "10" }
$Repetitions = if ($env:REPETITIONS) { [int]$env:REPETITIONS } else { 3 }

New-Item -ItemType Directory -Force -Path "$Root\bench\results" | Out-Null
python -c "import cryptography" 
if ($LASTEXITCODE -ne 0) {
  throw "Python package 'cryptography' is required. pip install -r bench/testdata/requirements.txt"
}

Write-Host "unit tests and release builds"
cargo test --release -p rust-service
if ($LASTEXITCODE -ne 0) { throw "cargo test failed" }
cargo build --release -p crypto-bench
if ($LASTEXITCODE -ne 0) { throw "cargo build failed" }
dotnet test "$Root\dotnet-service\tests\CryptoBench.Tests.csproj" -c Release --nologo
dotnet publish "$Root\dotnet-service\CryptoBench.csproj" -c Release -o "$Root\dotnet-service\publish" --nologo
python "$Root\bench\check_vectors.py"
if ($LASTEXITCODE -ne 0) { throw "vector check failed" }

$RustExe = Join-Path $Root "target\release\rust-service.exe"
$DotnetExe = Join-Path $Root "dotnet-service\publish\cryptobench.exe"
if (-not (Test-Path $RustExe)) { $RustExe = Join-Path $Root "target\release\rust-service" }
if (-not (Test-Path $DotnetExe)) { $DotnetExe = Join-Path $Root "dotnet-service\publish\cryptobench" }

function Stop-Server($Proc) {
  if ($null -ne $Proc -and -not $Proc.HasExited) {
    Stop-Process -Id $Proc.Id -Force -ErrorAction SilentlyContinue
    $Proc.WaitForExit()
  }
}

Write-Host "interop against the release binaries"
$env:PORT = "8081"
$env:BIND = "127.0.0.1"
$rust = Start-Process -FilePath $RustExe -PassThru -WindowStyle Hidden -RedirectStandardError "$Root\bench\results\interop-rust.log"
$env:ASPNETCORE_URLS = "http://127.0.0.1:8082"
$dotnet = Start-Process -FilePath $DotnetExe -PassThru -WindowStyle Hidden -RedirectStandardError "$Root\bench\results\interop-dotnet.log"
try {
  $ok = $false
  foreach ($i in 1..100) {
    try {
      $a = (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:8081/health" -TimeoutSec 2).Content.Trim()
      $b = (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:8082/health" -TimeoutSec 2).Content.Trim()
      if ($a -eq "ok" -and $b -eq "ok") { $ok = $true; break }
    } catch { Start-Sleep -Milliseconds 100 }
  }
  if (-not $ok) { throw "services did not become healthy" }
  python "$Root\bench\interop.py" --rust "http://127.0.0.1:8081" --dotnet "http://127.0.0.1:8082"
  if ($LASTEXITCODE -ne 0) { throw "interop failed" }
} finally {
  Stop-Server $rust
  Stop-Server $dotnet
}

@"
date_utc=$((Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"))
rustc=$(rustc --version)
dotnet_sdk=$(dotnet --version)
os=$([Environment]::OSVersion.VersionString)
processors=$([Environment]::ProcessorCount)
concurrency=$Concurrency
warmup_secs=$Warmup
duration_secs=$Duration
repetitions=$Repetitions
affinity=not applied on Windows
resource_sampling=n/a (crypto-bench reads /proc on Linux only)
"@ | Set-Content -Encoding utf8 "$Root\bench\results\environment.txt"

Set-Content -Encoding ascii "$Root\bench\results\runs.jsonl" ""
$Bench = Join-Path $Root "target\release\crypto-bench.exe"
if (-not (Test-Path $Bench)) { $Bench = Join-Path $Root "target\release\crypto-bench" }

foreach ($service in @("rust", "dotnet")) {
  Write-Host "benchmark $service"
  if ($service -eq "rust") {
    $env:PORT = "8081"
    $env:BIND = "127.0.0.1"
    $env:TOKIO_WORKER_THREADS = "2"
    Remove-Item Env:ASPNETCORE_URLS -ErrorAction SilentlyContinue
    $proc = Start-Process -FilePath $RustExe -PassThru -WindowStyle Hidden -RedirectStandardError "$Root\bench\results\rust-bench.log"
    $base = "http://127.0.0.1:8081"
  } else {
    $env:ASPNETCORE_URLS = "http://127.0.0.1:8082"
    $proc = Start-Process -FilePath $DotnetExe -PassThru -WindowStyle Hidden -RedirectStandardError "$Root\bench\results\dotnet-bench.log"
    $base = "http://127.0.0.1:8082"
  }
  try {
    $healthy = $false
    foreach ($i in 1..100) {
      try {
        $body = (Invoke-WebRequest -UseBasicParsing "$base/health" -TimeoutSec 2).Content.Trim()
        if ($body -eq "ok") { $healthy = $true; break }
      } catch { Start-Sleep -Milliseconds 100 }
    }
    if (-not $healthy) { throw "$service failed to start" }
    foreach ($size in @(1024, 65536, 1048576)) {
      foreach ($rep in 1..$Repetitions) {
        Write-Host "  payload=$size rep=$rep"
        & $Bench load --url "$base/v1/process" --pid $proc.Id --service $service `
          --payload-bytes $size --repetition $rep --concurrency $Concurrency `
          --warmup-secs $Warmup --duration-secs $Duration `
          --output "$Root\bench\results\runs.jsonl"
        if ($LASTEXITCODE -ne 0) { throw "load failed" }
      }
    }
  } finally {
    Stop-Server $proc
    Start-Sleep -Seconds 1
  }
}

& $Bench report --input "$Root\bench\results\runs.jsonl" `
  --markdown "$Root\bench\results\results.md" `
  --csv "$Root\bench\results\results.csv" `
  --env-file "$Root\bench\results\environment.txt"
if ($LASTEXITCODE -ne 0) { throw "report failed" }
Write-Host "results: $Root\bench\results\results.md"

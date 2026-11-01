# MSSQL ingest

English summary: two HTTP services, .NET 10 and Rust, accept `POST /v1/ingest` and acknowledge only after Microsoft SQL Server commits the row. The .NET service can write one `INSERT` per request or a `SqlBulkCopy` batch. The Rust service uses tiberius 0.13 bulk load for the batch path and one parameterized `INSERT` for the single path. A bounded queue returns 429 when it is full. SQL Server 2022 runs in Docker. `scripts/measure.sh` holds a constant arrival rate and checks that `COUNT(*)` matches acknowledged requests.

On this 4-vCPU cloud VM, all three measured setups held 1,000 requests/second for 60 seconds with no errors, and the row count matched the 202 responses (including warmup). One INSERT was faster at that rate (p50 0.83 ms versus about 10–12 ms for batches, which wait for a 10 ms flush). Batching is what still answered 8,000 rps with no errors. One INSERT started returning 429 between 3,000 and 5,000 rps. At 12,000 rps the batch writers fell behind (p50 118 ms on .NET, 34 ms on Rust) while SQL CPU stayed under about 65%. Every number is indicative of this single VM, not a production capacity claim.

## 무엇을 재는지

요청 하나가 서비스에 들어와서 SQL Server에 커밋된 뒤에야 `202`를 돌려준다. 커밋 전에 성공으로 응답하는 fire-and-forget 경로는 없다. 목표 부하는 워밍업 이후 60초 동안 초당 1,000 요청이고, 그 다음 단계적으로 올려 어디서 포화되는지 본다.

한 번의 클라우드 VM 측정이다. 아래 표의 숫자는 그 한 번의 실행이며, 다른 머신이나 디스크, 복제 구성으로 옮기면 달라진다.

## 구성

```
mssql-ingest/
  sql/                 스키마. 두 서비스가 시작 때 같은 파일을 적용한다
  dotnet/              .NET 10 Kestrel minimal API
  rust/                axum + tokio + tiberius 0.13
  load/                k6 상수 도착률 / 단계 상승
  scripts/measure.sh   빌드, 적재, 카운트, CPU/메모리 샘플
  docker-compose.yml   SQL Server 2022 Developer
```

`bench/`, `rust-service/`, `dotnet-service/` 는 이 작업에서 바꾸지 않는다. Rust 크레이트는 루트 Cargo 워크스페이스 밖에 둔다.

## 계약

`POST /v1/ingest`

```json
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "sourceId": "device-1",
  "timestamp": "2026-11-01T15:34:00Z",
  "payload": "up to 1024 UTF-16 code units"
}
```

| 상태 | 의미 |
| --- | --- |
| 202 `{"status":"committed"}` | 행이 커밋된 뒤 |
| 400 | JSON 또는 필드가 계약과 다름 |
| 409 `duplicate_id` | 기본 키 충돌. 배치 모드에서는 그 배치 전체가 롤백되고, 배치 안 요청이 모두 409가 된다 |
| 429 `queue_full` | 대기열이 가득 참. 메모리를 늘리지 않는다 |
| 503 `write_failed` | 커밋하지 못함 |

`GET /health` 는 프로세스만 본다. `GET /ready` 는 `SELECT 1` 이다. `GET /stats` 는 큐 깊이, 배치 크기, 플러시 간격, 커밋 수를 보여 준다. 인증이 없으므로 로컬 벤치마크용이다.

## 스키마

`dbo.ingest_events` 는 힙이다. `id` 는 비클러스터형 기본 키라서 무작위 GUID 삽입이 클러스터형 키처럼 페이지를 흩지 않는다. 데이터베이스는 `RECOVERY SIMPLE`, `DELAYED_DURABILITY = DISABLED`, `READ_COMMITTED_SNAPSHOT` 이다. SIMPLE 은 로그를 자동으로 자르지만, 지연 내구성을 끈 상태라 커밋은 로그 플러시를 기다린다. 이 설정은 로컬과 CI용이다.

## 쓰기 방식

두 서비스 모두 `INGEST_WRITE_MODE=batch|single` 이다.

- **batch:** 요청은 상한이 있는 채널에 들어가고, 호출자는 그 배치가 커밋될 때까지 기다린다. .NET 은 `SqlBulkCopy` 와 `UseInternalTransaction`. Rust 는 tiberius `bulk_insert_columns` (`INSERT BULK`). 기본값은 배치 128행, 플러시 10ms, 라이터 2개, 큐 16384.
- **single:** 요청마다 매개변수 `INSERT` 하나. 동시에 열린 작업 수는 연결 풀 상한(기본 128)이고, 그 이상이면 429.

배치가 기본 키 충돌로 실패하면 그 배치 전체를 롤백한다. 부하 생성기는 실행 안에서 유일한 id 를 만든다.

Rust 드라이버는 tiberius 0.13 이다. TLS 는 rustls 이고, 컨테이너의 자체 서명 인증서는 `trust_cert()` 로만 로컬에서 신뢰한다. 대량 적재 API 가 있어 같은 배치 방식을 코드로 넣었다. 연결이 되는지는 이 README 의 측정으로 확인한다.

## 실행

비밀번호 기본값 `Ingest_Local_Dev1!` 는 로컬용 일회용 값이다. 실제 비밀번호를 커밋하지 말 것. SQL Server 는 복잡한 비밀번호를 요구한다.

```bash
cd mssql-ingest
docker compose up -d

# .NET 배치, 워밍업 15초 뒤 60초 동안 1000 rps
./scripts/measure.sh dotnet batch sustain

# .NET 한 건씩 INSERT
./scripts/measure.sh dotnet single sustain

# Rust 배치
./scripts/measure.sh rust batch sustain

# 200 → 3000 rps 단계 상승
./scripts/measure.sh dotnet batch step
./scripts/measure.sh dotnet single step
./scripts/measure.sh rust batch step

# CI 와 같은 짧은 확인. 약 10초, 50 rps
./scripts/measure.sh dotnet batch smoke
./scripts/measure.sh rust batch smoke
```

`measure.sh` 는 서비스를 Release 로 빌드하고, 테이블을 비운 뒤, k6 를 돌리고, `COUNT(*)` 와 `COUNT(DISTINCT id)` 를 비교하고, 서비스 프로세스와 SQL 컨테이너의 CPU/메모리를 1초마다 샘플한다. 결과 JSON 은 `results/` 에 남고 git 에는 올리지 않는다. 이 문서의 표가 그 실행의 기록이다.

환경 변수: `MSSQL_HOST`, `MSSQL_PORT`, `MSSQL_USER`, `MSSQL_PASSWORD`, `MSSQL_DATABASE`, `INGEST_WRITE_MODE`, `INGEST_BATCH_SIZE`, `INGEST_FLUSH_MS`, `INGEST_WRITERS`, `INGEST_QUEUE_CAPACITY`, `INGEST_MAX_POOL_SIZE`, `BIND`, `PORT`, `RATE`, `DURATION`, `WARMUP`, `PAYLOAD_BYTES`.

필요 도구: Docker, .NET SDK 10, Rust 1.99.1 (`rust-toolchain.toml`), Python 3. k6 v2.3.0 은 `scripts/install-k6.sh` 가 `mssql-ingest/.tools/k6` 에 받는다. Rust 빌드는 시스템 OpenSSL 이 필요 없다. tiberius 를 rustls 로 연결한다.

CI (`.github/workflows/mssql-ingest.yml`) 는 `mssql-ingest/**` 만 보고, 두 서비스를 빌드한 뒤 smoke 만 돌린다. 60초 측정은 CI 에 없다.

## 결과

한 대의 클라우드 VM 에서 나온 참고치다. 4 vCPU (Intel Xeon), 게스트 메모리 15 GiB 이며 하이퍼바이저 풍선이 켜져 있다. SQL Server 2022 Developer 16.0.4305.5 는 컨테이너이고 메모리 상한 2048 MB, `shm` 1 GB, 복구 모델 SIMPLE, 지연 내구성 끔, 단일 노드, 복제 없다. 페이로드는 ASCII 512바이트. 서비스는 호스트 프로세스이고 SQL 만 컨테이너다. 두 서비스를 동시에 띄우지 않았다. 배치 설정은 크기 128, 플러시 10ms, 라이터 2, 큐 16384, 단일 모드 동시성 128. CPU 는 코어 하나 기준 100% 이다. 행 수는 그 실행에서 202 를 받은 요청 전체(워밍업 포함)와 같고, `COUNT(DISTINCT id)` 도 그 값과 같았다. 429 는 표에 쓰지 않았다.

### 60초, 목표 1000 rps

워밍업 15초 × 200 rps 다음 60초. 세 구성 모두 목표를 유지했다. 오류는 0 이고, DB 행 수는 202 와 같다.

| 서비스 | 방식 | 달성 rps | p50 | p95 | p99 | 오류 | 202 = 행 | 평균 배치 | 서비스 CPU 평균/최대 | 서비스 RSS | SQL CPU 평균/최대 | SQL 메모리 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| .NET | batch | 1000.0 | 11.9 ms | 21.7 ms | 26.2 ms | 0 | 63001 | 7.0행 | 34% / 57% | 157 MiB | 48% / 57% | 825 MiB |
| .NET | single | 1000.0 | 0.83 ms | 2.0 ms | 5.7 ms | 0 | 63002 | — | 41% / 57% | 152 MiB | 40% / 51% | 841 MiB |
| Rust | batch | 1000.0 | 10.0 ms | 15.2 ms | 17.4 ms | 0 | 63001 | 9.8행 | 8% / 10% | 26 MiB | 22% / 27% | 842 MiB |

이 속도에서 배치가 처리량을 올려 주지는 않는다. 한 건 INSERT 가 이미 1000 rps 를 p50 1 ms 아래로 소화한다. 배치의 p50 은 플러시 10 ms 와 거의 같다. 이 구간에서 배치의 이득은 지연이 아니라 CPU 다. Rust 배치는 서비스 CPU 약 8%, SQL CPU 약 22% 로 .NET 단일 INSERT (서비스 약 41%, SQL 약 40%) 보다 가볍다. .NET `SqlBulkCopy` 는 평균 7행이라 고정 비용이 커서, 1000 rps 에서는 단일 INSERT 보다 SQL CPU 가 약간 더 높고 지연은 더 길다.

### 단계 상승

k6 `ramping-arrival-rate` 로 200 에서 3000 rps 까지 110초에 걸쳐 올렸다. 초 단위로 센 달성률은 일정표를 따라갔고, 어느 쪽도 3000 아래에서 무너지지 않았다.

| 서비스 | 방식 | 1초 최대 | 202 가 아닌 응답 |
| --- | --- | --- | --- |
| .NET | batch | 2997 rps | 0 |
| .NET | single | 2940 rps | 429 가 11건, 약 2890 rps 부근 |
| Rust | batch | 2947 rps | 0 |

### 20초 평탄 구간

1000 rps 가 천장이 아니어서, 같은 설정으로 더 높은 상수 도착률을 20초씩 잡았다. 워밍업은 5초다. 이 줄은 60초 증명보다 짧다.

| 서비스 | 방식 | 목표 | 달성 rps | p50 | p95 | p99 | 오류 | 평균 배치 | 서비스 CPU 평균/최대 | SQL CPU 평균/최대 | k6 가 놓친 반복 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| .NET | single | 5000 | 5001 | 3.4 ms | 33 ms | 89 ms | 3.33% (429) | — | 93% / 126% | 119% / 151% | 0 |
| .NET | batch | 5000 | 5000 | 14.6 ms | 35 ms | 50 ms | 0 | 40행 | 60% / 87% | 44% / 54% | 11 |
| Rust | batch | 5000 | 5000 | 10.7 ms | 17 ms | 23 ms | 0 | 47행 | 18% / 22% | 26% / 30% | 0 |
| .NET | single | 8000 | 7741 | 18.8 ms | 105 ms | 186 ms | 25.8% (429) | — | 81% / 121% | 112% / 154% | 5173 |
| .NET | batch | 8000 | 8000 | 15.8 ms | 54 ms | 80 ms | 0 | 64행 | 61% / 112% | 46% / 58% | 55 |
| Rust | batch | 8000 | 8002 | 13.6 ms | 38 ms | 68 ms | 0 | 72행 | 26% / 32% | 32% / 42% | 0 |
| .NET | batch | 12000 | 11311 | 118 ms | 239 ms | 263 ms | 0 | 103행 | 66% / 101% | 48% / 64% | 13875 |
| Rust | batch | 12000 | 11872 | 34 ms | 147 ms | 193 ms | 0 | 99행 | 34% / 43% | 38% / 50% | 2600 |

읽는 법:

- **1000 rps 는 세 구성 모두 60초 동안 유지됐다.**
- 단일 INSERT 는 3000 rps 근처에서 429 가 처음 보이고, 5000 rps 에서 약 3%, 8000 rps 에서 약 26% 가 429 다. SQL CPU 가 코어 하나 반까지 올라 포화에 가깝고, 동시성 상한 128 이 그 부하를 429 로 흘려보낸다. DB 에 들어간 행 수는 202 와 일치한다. 429 는 커밋되지 않았다.
- 배치는 8000 rps 를 20초 동안 오류 없이 유지했다. 12000 rps 는 유지하지 못했다. .NET 은 약 11300 rps, Rust 는 약 11900 rps 를 받았고 429 는 없었다. 대신 p50 이 .NET 118 ms, Rust 34 ms 로 벌어졌고, k6 가 느린 응답 때문에 반복을 놓쳤다. 그때 SQL CPU 는 65% 아래였다. 라이터 2개와 배치 128 이 먼저 막힌 것이고, SQL 코어가 모두 찬 것은 아니다.
- 그래서 이 VM 에서 배치가 의미 있는 지점은 1000 rps 가 아니라 그 위다. 1000 rps 에서는 단일 INSERT 가 더 짧고, 5000 rps 부터는 배치만 오류 없이 도착률을 따라간다.

재현은 위의 `measure.sh` 세 줄에 더해 다음이다. `STRICT=0` 은 목표를 못 채워도 스크립트가 측정 파일을 남기게 한다.

```bash
RATE=5000 DURATION=20s WARMUP=5s WARMUP_RATE=1500 PRE_ALLOCATED_VUS=800 MAX_VUS=4000 STRICT=0 \
  ./scripts/measure.sh dotnet single sustain
RATE=8000 DURATION=20s WARMUP=5s WARMUP_RATE=2000 PRE_ALLOCATED_VUS=1200 MAX_VUS=5000 STRICT=0 \
  ./scripts/measure.sh dotnet batch sustain
RATE=12000 DURATION=20s WARMUP=5s WARMUP_RATE=3000 PRE_ALLOCATED_VUS=2000 MAX_VUS=6000 STRICT=0 \
  ./scripts/measure.sh rust batch sustain
./scripts/measure.sh dotnet batch step
```

단계 상승의 1초 최대는 k6 CSV 의 `http_reqs` 를 초 단위로 센 것이다. 램프는 구간 끝 속도까지 직선으로 올라가므로, 구간 평균을 끝 속도와 비교하면 포화된 것처럼 보인다. 그 비교는 쓰지 않았다.

## 숫자를 제한하는 것

- 이 VM 의 vCPU 4개와 풍선 메모리. SQL 컨테이너에 2 GB 상한을 줬다.
- 컨테이너 안의 SQL Server. 데이터 파일은 Docker 볼륨이고, 호스트 디스크의 지연이 커밋 시간에 그대로 들어간다.
- 단일 노드, 가용성 그룹이나 로그 전달이 없음.
- 복구 모델 SIMPLE. FULL 이면 로그 증가와 백업이 처리량을 더 깎는다.
- 지연 내구성을 끄면 커밋마다 로그 플러시가 있다. 켠 경우보다 느리고, 그게 이 벤치마크가 재려는 내구성이다.
- 힙과 비클러스터형 기본 키. 다른 인덱스나 외래 키는 없다.
- 배치 충돌 시 배치 전체 롤백. 중복이 섞이면 처리량이 급락한다.
- k6, 서비스, SQL 이 같은 VM 에서 CPU 를 나눈다. 클라이언트만 다른 머신에 두면 서비스 숫자가 달라진다.

## 측정하지 않은 것

- 장애 조치, 복제, 읽기 확장, 백업 중 부하.
- 인증, TLS 종단, 요청 서명. 벤치마크 포트는 HTTP 이다. SQL 세션만 TLS (rustls / SqlClient Encrypt) 이다.
- 1 KB 를 넘는 페이로드, 다수 테이블, 트리거, 보조 인덱스.
- 여러 서비스 인스턴스, 샤딩, 다른 디스크 장치.
- 장시간 실행 후의 로그 증가, 체크포인트 스톨, 인덱스 단편화. 60초와 약 2분의 단계 상승뿐이다.
- GC 와 커널 튜닝의 탐색. .NET 은 Server GC, ReadyToRun, tiered PGO, 스레드풀 최소 128. Rust 는 thin LTO, codegen-units 1, tokio 워커는 CPU 수.
- 정확히 같은 순간에 두 언어를 같이 돌리는 경우.

## 소유자가 정할 것

- 1000 rps 만 필요하면 단일 INSERT 가 지연이 더 짧다. 5000 rps 근처부터는 배치가 429 없이 버틴다. 어느 쪽을 기본으로 둘지.
- 라이터를 2 보다 늘릴지. 12000 rps 에서 SQL CPU 는 65% 아래였고, 막힌 쪽은 라이터와 큐 지연이다. 라이터를 늘린 측정은 하지 않았다.
- 프로덕션 복구 모델을 SIMPLE 로 둘지 FULL 로 둘지. 이 저장소의 기본값은 벤치마크용 SIMPLE 이다.
- 배치 안 중복 한 건이 배치 전체를 실패시켜도 되는지. 격리해서 재시도하는 경로는 넣지 않았다.
- 플러시 10ms / 배치 128 을 지연과 처리량 중 어디에 맞출지. 10 ms 는 1000 rps 배치 p50 의 대부분이다.
- 응답 코드를 202 로 고정할지. 계약은 202 이고, 200 도 커밋 뒤라면 같은 의미로 받을 수 있다.
- 실제 SA 비밀번호와 포트 노출. 기본 비밀번호는 로컬 전용이다.

# MSSQL ingest

English summary: two HTTP services, .NET 10 and Rust, accept `POST /v1/ingest` and acknowledge only after Microsoft SQL Server commits the row. The .NET service can write one `INSERT` per request or a `SqlBulkCopy` batch. The Rust service uses tiberius bulk load for the batch path and one parameterized `INSERT` for the single path. A bounded queue returns 429 when it is full. SQL Server 2022 runs in Docker. `scripts/measure.sh` holds a constant arrival rate and checks that `COUNT(*)` matches acknowledged requests. Every number below is an indicative result from one cloud VM, not a capacity claim for production hardware.

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

측정 조건: 클라우드 VM 4 vCPU, SQL Server 2022 Developer (`mcr.microsoft.com/mssql/server:2022-latest`, 16.0.4305.5) 컨테이너, 메모리 상한 2048 MB, `shm` 1 GB, 복구 모델 SIMPLE, 지연 내구성 끔, 단일 노드, 복제 없음. 페이로드는 ASCII 512바이트. 서비스는 호스트 프로세스이고 SQL 만 컨테이너다. 두 서비스를 동시에 띄우지 않았다. 도착률은 k6 `constant-arrival-rate` 이고, 지연은 그 구간의 `http_req_duration` 이다. CPU 는 코어 하나 기준 100% 이다 (400% 면 4코어를 다 씀). 행 수는 그 실행에서 202 를 받은 요청 전체(워밍업 포함)와 같다.

표의 숫자는 아래 커밋에 적힌 실행에서 채운다. 아직 60초 실행 전이면 이 문장이 남아 있다. 실행이 끝나면 이 문단을 표로 바꾼다.

짧은 smoke (50 rps, 지속 10초, .NET 배치) 는 도구가 행 수와 202 를 맞추는지 확인한 것이다. 달성 50.1 rps, p50 16.3 ms, 오류 0, 행 542 = 승인 542, distinct 542. 이 속도에서는 요청 간격이 플러시 10ms 보다 길어서 평균 배치 크기가 약 1행이었다. 1000 rps 구간의 배치 크기는 본 측정에서 따로 적는다.

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

- 프로덕션 복구 모델을 SIMPLE 로 둘지 FULL 로 둘지. 이 저장소의 기본값은 벤치마크용 SIMPLE 이다.
- 배치 안 중복 한 건이 배치 전체를 실패시켜도 되는지. 격리해서 재시도하는 경로는 넣지 않았다.
- 플러시 10ms / 배치 128 / 라이터 2 를 지연과 처리량 중 어디에 맞출지.
- 응답 코드를 202 로 고정할지. 계약은 202 이고, 200 도 "커밋 후"라면 같은 의미로 받을 수 있다.
- 실제 SA 비밀번호와 포트 노출. 기본 비밀번호는 로컬 전용이다.

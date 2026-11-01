# MSSQL ingest

English summary: the upstream sender is a payment VAN. It posts one transaction at a time and resends the same `vantr` whenever the answer is not success. Both services return 202 `{"status":"committed"}` only after SQL Server has committed that `vantr`, and they return that same body again when the VAN resends a `vantr` that is already stored. A resend never inserts a second row. One bad row in a batch does not fail the other rows. Queue full, timeout, and database errors are non-2xx, so the VAN resends. `vantr` is `NVARCHAR(128)`; that length is an assumption. Numbers below are indicative of one cloud VM.

## 무엇을 재는지

밴사(VAN)가 거래 한 건씩 실시간으로 보내고, 실패 응답을 받으면 같은 `vantr` 를 다시 보낸다. 서비스는 그 `vantr` 가 커밋된 뒤에만 202 를 준다. 이미 커밋된 `vantr` 를 다시 받으면 같은 202 본문을 주고 행은 늘리지 않는다. 큐가 가득 차거나, 시간이 다 되거나, DB 가 실패하면 2xx 가 아니므로 밴사가 재전송한다. 커밋된 거래를 202 없이 잃는 경로는 두지 않는다. 응답은 실패인데 실제로는 커밋된 경우, 재전송이 202 로 끝난다.

아래 숫자는 이 클라우드 VM 한 대에서의 참고치다.

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
  "vantr": "VAN202611010001234567",
  "sourceId": "terminal-1",
  "timestamp": "2026-11-01T15:34:00Z",
  "payload": "up to 1024 UTF-16 code units"
}
```

`vantr` 가 밴사 거래의 고유 키다. 승인번호와 일자처럼 나뉜 실제 키는 보내는 쪽이 이 문자열 하나로 합쳐야 한다. 컬럼은 `NVARCHAR(128)` 이다. 128자는 명세가 오기 전의 가정이다. 더 길면 `400 invalid_vantr` 이다.

성공 본문은 처음이든 재전송이든 같다. `{"status":"committed"}`.

| 상태 | 언제 | 밴사 동작 |
| --- | --- | --- |
| 202 | `vantr` 행이 커밋된 뒤. 이미 있던 `vantr` 도 같다 | 재전송하지 않음 |
| 400 | JSON 이 깨졌거나 `vantr`, `sourceId`, 시각, 페이로드가 계약에 안 맞음 | 실패로 보고 재전송함. 고치지 않으면 같은 요청이 반복된다 |
| 429 `queue_full` | 대기열이 가득 참. 이 요청은 커밋되지 않았다 | 재전송 |
| 503 `write_failed` | DB 오류, 시간 초과, 연결 실패. 이 응답은 커밋을 보장하지 않는다 | 재전송. 이미 커밋됐으면 그때 202 |

409 는 쓰지 않는다. 중복은 오류가 아니다.

`GET /health` 는 프로세스만 본다. `GET /ready` 는 `SELECT 1` 이다. `GET /stats` 는 큐와 배치 설정이다. 인증이 없으므로 로컬 벤치마크용이다.

## 스키마

`dbo.ingest_events` 는 힙이다. `vantr` 유니크 인덱스는 `IGNORE_DUP_KEY = ON` 이다. 기본 키에는 이 옵션을 걸 수 없어서 유니크 인덱스가 키다. 같은 문 안의 다른 행은 중복 때문에 롤백되지 않는다. 데이터베이스는 `RECOVERY SIMPLE`, `DELAYED_DURABILITY = DISABLED`, `READ_COMMITTED_SNAPSHOT` 이다. SIMPLE 은 로그를 자동으로 자르지만, 지연 내구성을 끈 상태라 커밋은 로그 플러시를 기다린다. 이 설정은 로컬과 CI용이다. 예전 `id` 컬럼만 있는 테이블은 시작 때 지우고 다시 만든다. 벤치마크 스키마이며 운영 데이터 이관은 아니다.

## 쓰기 방식

두 서비스 모두 `INGEST_WRITE_MODE=batch|single` 이다.

- **batch:** 요청은 상한이 있는 채널에 들어가고, 그 행이 커밋되거나 실패로 갈라진 뒤에 응답한다. .NET 은 임시 테이블에 `SqlBulkCopy` 한 뒤 `INSERT ... WHERE NOT EXISTS`. Rust 는 매개변수 여러 행 `INSERT ... WHERE NOT EXISTS`. 한 범위가 데이터 오류로 실패하면 반으로 나눠 다시 시도한다. 한 행이 실패해도 그 `vantr` 가 이미 있으면 202 다. 연결 끊김과 시간 초과는 나누지 않고 그 범위 전체를 503 으로 둔다. 기본값은 배치 128행, 플러시 10ms, 라이터 2개, 큐 16384.
- **single:** 요청마다 `INSERT ... WHERE NOT EXISTS` 하나. 이미 있으면 202 다. 동시에 열린 작업 수는 연결 풀 상한(기본 128)이고, 그 이상이면 429.

같은 배치에 같은 `vantr` 가 두 번 있으면 행은 하나다. 먼저 도착한 페이로드가 남고, 나중 값은 비교하지 않는다. 재전송 본문이 달라도 202 다.

Rust 드라이버는 tiberius 0.13 이고 TLS 는 rustls 다. 컨테이너의 자체 서명 인증서는 `trust_cert()` 로만 로컬에서 신뢰한다.

## 실행

비밀번호 기본값 `Ingest_Local_Dev1!` 는 로컬용 일회용 값이다. 실제 비밀번호를 커밋하지 말 것. SQL Server 는 복잡한 비밀번호를 요구한다.

```bash
cd mssql-ingest
docker compose up -d

# 재전송 약 8%. 워밍업 15초 뒤 60초 동안 1000 rps
RESEND_RATIO=0.08 ./scripts/measure.sh dotnet batch sustain
RESEND_RATIO=0.08 ./scripts/measure.sh dotnet single sustain
RESEND_RATIO=0.08 ./scripts/measure.sh rust batch sustain
RESEND_RATIO=0.08 ./scripts/measure.sh rust single sustain

# SQL 을 몇 초 멈춘 뒤 재전송. 컨테이너 이름이 다르면 SQL_CONTAINER 를 준다
./scripts/outage.sh dotnet batch
./scripts/outage.sh dotnet single
./scripts/outage.sh rust batch

# CI 와 같은 짧은 확인. 약 10초, 50 rps, 재전송 10%, 같은 vantr 두 번 202
./scripts/measure.sh dotnet batch smoke
./scripts/measure.sh rust batch smoke
```

`measure.sh` 는 서비스를 Release 로 빌드하고, 테이블을 비운 뒤, k6 를 돌리고, `COUNT(*)` 와 `COUNT(DISTINCT vantr)` 를 비교한다. 재전송이 있으면 202 횟수는 행 수보다 많고, 중복 행은 0 이어야 한다. 서비스와 SQL 컨테이너의 CPU/메모리를 1초마다 샘플한다. 결과 JSON 은 `results/` 에 남고 git 에는 올리지 않는다.

환경 변수: `MSSQL_HOST`, `MSSQL_PORT`, `MSSQL_USER`, `MSSQL_PASSWORD`, `MSSQL_DATABASE`, `INGEST_WRITE_MODE`, `INGEST_BATCH_SIZE`, `INGEST_FLUSH_MS`, `INGEST_WRITERS`, `INGEST_QUEUE_CAPACITY`, `INGEST_MAX_POOL_SIZE`, `BIND`, `PORT`, `RATE`, `DURATION`, `WARMUP`, `PAYLOAD_BYTES`, `RESEND_RATIO`, `RETRY_ATTEMPTS`, `HTTP_TIMEOUT`.

필요 도구: Docker, .NET SDK 10, Rust 1.99.1 (`rust-toolchain.toml`), Python 3. k6 v2.3.0 은 `scripts/install-k6.sh` 가 `mssql-ingest/.tools/k6` 에 받는다. Rust 빌드는 시스템 OpenSSL 이 필요 없다. tiberius 를 rustls 로 연결한다.

CI (`.github/workflows/mssql-ingest.yml`) 는 `mssql-ingest/**` 만 보고, 두 서비스를 빌드한 뒤 smoke 만 돌린다. 60초 측정은 CI 에 없다.

## 결과

한 대의 클라우드 VM 에서 나온 참고치다. 4 vCPU (Intel Xeon), 게스트 메모리 15 GiB 이며 하이퍼바이저 풍선이 켜져 있다. SQL Server 2022 Developer 16.0.4305.5 는 컨테이너이고 메모리 상한 2048 MB, `shm` 1 GB, 복구 모델 SIMPLE, 지연 내구성 끔, 단일 노드, 복제 없다. 페이로드는 ASCII 512바이트. 서비스는 호스트 프로세스이고 SQL 만 컨테이너다. 네 구성을 동시에 띄우지 않았다. 배치 설정은 크기 128, 플러시 10ms, 라이터 2, 큐 16384, 단일 모드 동시성 128. CPU 는 코어 하나 기준 100% 이다.

재전송은 각 VU 가 바로 전에 보낸 `vantr` 를 약 8% 확률로 다시 쓰는 방식이다. 그래서 202 횟수는 행 수보다 많다. 맞는 등식은 `행 수 = COUNT(DISTINCT vantr)` 이고, 그 차이는 0 이다. 202 를 받은 `vantr` 는 테이블에 있다.

### 60초, 목표 1000 rps, 재전송 약 8%

워밍업 15초 × 200 rps 다음 60초. 도착률 1000 rps 는 네 구성 모두 유지했다.

| 서비스 | 방식 | 달성 rps | p50 | p95 | p99 | 비-2xx | 202 | 행 | distinct | 중복 행 | 재전송 비율 | 서비스 CPU 평균/최대 | SQL CPU 평균/최대 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| .NET | batch | 1000.0 | 14.7 ms | 26.9 ms | 41.5 ms | 0 | 63001 | 57959 | 57959 | 0 | 8.0% | 36% / 83% | 64% / 75% |
| .NET | single | 1000.0 | 1.09 ms | 5.3 ms | 9.9 ms | 0 | 63001 | 58097 | 58097 | 0 | 7.8% | 45% / 81% | 45% / 73% |
| Rust | batch | 1000.0 | 9.1 ms | 14.4 ms | 17.7 ms | 0 | 63000 | 57977 | 57977 | 0 | 8.0% | 9% / 11% | 15% / 20% |
| Rust | single | 1000.0 | 0.90 ms | 3.7 ms | 7.7 ms | 76건 429 (0.13%) | 62926 | 57941 | 57941 | 0 | 7.9% | 11% / 15% | 40% / 97% |

Rust 단일 모드의 429 는 지속 60초 중 60001건 가운데 76건이다. 동시성 상한 128 을 잠깐 넘긴 요청이고, 커밋 응답이 아니다. 밴사가 다시 보내면 된다. 중복 행은 0 이다. 이 속도에서 단일 INSERT 의 p50 이 배치보다 짧다. 배치 p50 에는 플러시 10ms 가 들어 있다.

### DB 를 잠시 멈춘 실행

`docker pause` 로 SQL 컨테이너를 4초 멈춘 뒤 다시 살렸다. 부하는 200 rps, 25초, 재전송 8%, 클라이언트 시간 초과 3초, 실패 시 같은 `vantr` 를 최대 6번 즉시 재시도. k6 의 상태 `0` 은 클라이언트 시간 초과다.

| 서비스 | 방식 | HTTP 비-2xx | 최종 202 | 행 | distinct | 중복 행 | p50 | p99 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| .NET | batch | 시간 초과 148 | 4735 | 4399 | 4399 | 0 | 16.0 ms | 3001 ms |
| .NET | single | 429 4477, 시간 초과 128 | 4470 | 4156 | 4156 | 0 | 0.6 ms | 3000 ms |
| Rust | batch | 시간 초과 148 | 4734 | 4434 | 4434 | 0 | 9.6 ms | 3001 ms |

멈춘 동안의 시간 초과와 429 는 2xx 가 아니다. 단일 모드는 멈춰 있는 SQL 호출이 동시성 슬롯을 잡고 있어서, 바로 이은 재시도도 429 가 되었다. 그 429 는 삽입 전에 거절된 것이다. 중복 행은 세 실행 모두 0 이다.

이어서 단일 모드로 확인한 한 건은 이렇다. `OUTAGE-1` 은 202 였다. SQL 을 멈춘 동안 `OUTAGE-1` 재전송과 새 `OUTAGE-2` 는 둘 다 클라이언트 시간 초과였다. 다시 살린 뒤 둘 다 202 였고, `OUTAGE-1` 을 한 번 더 보내도 202 였다. 행은 2, distinct 도 2 였다.

## 숫자를 제한하는 것

- 이 VM 의 vCPU 4개와 풍선 메모리. SQL 컨테이너에 2 GB 상한을 줬다.
- 컨테이너 안의 SQL Server. 데이터 파일은 Docker 볼륨이고, 호스트 디스크의 지연이 커밋 시간에 그대로 들어간다.
- 단일 노드, 복제 없음. 복구 모델 SIMPLE. 지연 내구성은 꺼져 있어서 커밋마다 로그 플러시가 있다.
- 힙과 `vantr` 유니크 인덱스 하나. 다른 인덱스, 트리거, 외래 키는 없다.
- k6, 서비스, SQL 이 같은 VM 의 CPU 를 나눈다.
- 재전송 8% 는 VU 가 직전 `vantr` 를 다시 고르는 근사다. 밴사의 실제 재전송 간격과 다르다.
- DB 중단 실험의 p99 3000 ms 는 클라이언트 시간 초과 값이다. 서버의 SQL 명령 시간 초과는 그보다 길다.

## 측정하지 않은 것

- 장애 조치, 복제, 백업 중 부하, 장시간 체크포인트.
- 인증, 요청 서명, 클라이언트 TLS. 벤치마크 포트는 HTTP 다. SQL 세션만 TLS 다.
- `vantr` 가 128자를 넘는 경우, 1 KB 를 넘는 페이로드, 재전송 본문이 첫 본문과 다른 경우의 업무 규칙.
- 여러 서비스 인스턴스. 두 언어를 동시에 띄운 측정.
- 이번 멱등 경로에서 5000 rps 이상의 포화 재측정. 이전 GUID 키 실험의 높은 rps 숫자는 이 쓰기 경로의 숫자가 아니다.

## 소유자가 정할 것

- `vantr` 의 실제 최대 길이와 문자 집합. 지금은 `NVARCHAR(128)` 로 가정했다.
- 승인번호, 일자, 단말기 번호처럼 나뉜 밴사 키를 누가 어떤 규칙으로 `vantr` 한 칸에 합칠지.
- 재전송의 페이로드가 처음과 달라도 처음 값을 유지하는 현재 동작으로 둘지. 지금은 비교하지 않는다.
- 400 을 영구 오류로 볼지. 밴사는 400 도 실패로 보고 같은 잘못된 요청을 계속 재전송한다.
- 1000 rps 에서 단일 INSERT 가 지연이 더 짧다. 배치를 기본으로 둘지는 더 높은 목표 속도에 달렸다. 이번 변경 뒤의 포화점은 다시 재지 않았다.
- Rust 단일 모드의 429 0.13% 를 동시성 128 을 늘려 없앨지.
- 복구 모델을 SIMPLE 로 둘지 FULL 로 둘지.
- 성공 코드를 202 로 둘지, 커밋 뒤의 200 으로 둘지.
- 실제 SA 비밀번호와 포트 노출. 기본 비밀번호는 로컬 전용이다.

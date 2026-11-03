# 전생검신

브라우저에서 하는 1인용 랜덤 디펜스. 전생의 검객을 금화로 소환해 검로에 세우고, 같은 검 셋을 겹쳐 더 강한 한 자루로 만든다. 그림은 캔버스와 CSS로만 그린다. 이미지 파일도, 외부 라이브러리도 없다.

## 실행

`geomsin-defense/index.html` 을 브라우저로 연다.

또는 저장소 루트에서:

```bash
python3 -m http.server 8080
```

그리고 `http://localhost:8080/geomsin-defense/` 를 연다. 설치나 빌드는 없다.

휴대폰에서는 칸과 버튼을 누르고, 화면이 스크롤되거나 확대되지 않아야 한다. 가로 화면에서는 조작 버튼이 오른쪽으로 붙는다.

GitHub Pages가 Actions를 소스로 쓰면, Gloam은 사이트 루트에 그대로 있고 이 게임은 그 아래 경로로 올라간다.

**https://devyeonhoju-tech.github.io/codex/geomsin-defense/**

`index.html`의 `css/`와 `js/` 참조는 문서 기준 상대 경로라서, 이 하위 경로에서도 따로 빌드하지 않는다.

## 규칙

- **소환.** 금화를 쓰고 무작위 검을 받는다. 빈 칸을 눌러 놓는다.
- **재굴림.** 아직 놓지 않은 검을 버리고 다시 뽑는다. 소환 비용은 돌아오지 않는다.
- **각성.** 소환 등급의 확률을 올린다. 정점은 5단.
- **합체.** 같은 종류, 같은 등급의 검이 셋이 되면 그 자리의 다음 등급 검 하나가 된다. 이어서 조건이 맞으면 한 번 더 합체한다. 신화(5)는 더 합체하지 않는다.
- **자리.** 검을 고른 뒤 다른 칸을 누르면 옮기거나 서로 바꾼다. 그래서 사거리가 긴 검을 안쪽에 둘 수 있다.
- **방출.** 고른 검, 또는 손에 든 검을 금화로 바꾼다.
- **비급.** 서로 다른 검을 제물로 숨은 검을 만든다. 창이 열려 있는 동안 시간은 멈춘다.
- **전투.** 적은 검로를 걸어 문으로 간다. 검은 사거리 안의 가장 앞선 적을 스스로 벤다. 베기, 관통, 광역, 둔화, 진법이 다르다.
- **파도.** 준비 시간이 끝나면 다음 파도가 나온다. 출진으로 앞당길 수 있다. 5, 10, 15파에 우두머리가 온다.
- **패배.** 적이 문에 닿으면 목숨이 줄고, 0이면 진다.
- **승리.** 15파를 막으면 이긴다.
- **기록.** 최고 파도, 승리 횟수, 최단 승리 시간, 최다 처치는 이 브라우저의 `localStorage` 에 남는다.

등급은 일반, 희귀, 영웅, 전설, 신화다. 소환되는 검은 회검, 청명, 적염, 한빙, 진각, 월흔이다. 상극검, 삼재검, 새벽베기, 무정검신은 비급으로만 나온다.

## 균형 고치기

숫자는 `js/balance.js` 한 파일에만 있다.

| 고치고 싶은 것 | 위치 |
| --- | --- |
| 시작 금화, 목숨, 소환·재굴림·각성 비용, 준비 시간 | `meta` |
| 등급 배율 | `tiers` |
| 소환 확률 (각성 단계별, 1~5등급) | `weights` |
| 검의 공격력, 간격, 사거리 배수, 기술 | `families` |
| 비급 재료와 결과 | `recipes` |
| 적 체력, 속도, 금화, 누수 | `enemies` |
| 파도 구성과 일반 적 체력 배수 | `waves` |

`meta.pathRef / enemies.*.speed` 가 그 적이 검로를 걷는 데 걸리는 초다. 우두머리 체력은 `hpMul` 을 곱하지 않는다. `families` 의 `range` 는 칸 너비를 1로 둔 검로 방향 사거리다. 0.6이면 짧고, 1.5면 한 줄의 대부분에 닿는다. `splash` 와 `aura` 도 같은 칸 너비 단위다. `pityEvery` 번 연속으로 영웅 이상이 안 나오면 다음 소환은 적어도 `pityTier` 가 된다. `0` 이면 그 보정이 꺼진다.

---

# Jeonsaeng Geomsin

A single-player random-defense game in the browser. Spend gold to summon a sword bearer from a past life, set them on the sword road, and merge three identical copies into one stronger blade. Every picture is drawn with canvas and CSS. There are no image files and no libraries.

## Run

Open `geomsin-defense/index.html` in a browser.

Or from the repository root:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/geomsin-defense/`. Nothing to install or build.

On a phone, tap cells and buttons. The page should not scroll or zoom while you play. In landscape the buttons sit on the right.

When GitHub Pages uses Actions as its source, Gloam stays at the site root and this game is published under it:

**https://devyeonhoju-tech.github.io/codex/geomsin-defense/**

The `css/` and `js/` links in `index.html` are document-relative, so that subpath needs no build.

## Rules

- **Summon.** Spend gold for a random sword, then tap an empty cell.
- **Reroll.** Replace the sword still in hand. The summon cost is not refunded.
- **Awaken.** Raise the tier odds of future summons, up to level 5.
- **Merge.** Three of the same family and tier become one of the next tier. Chains resolve on their own. Mythic (5) does not merge.
- **Move.** Select a sword and tap another cell to move or swap, so long-range blades can sit farther from the road.
- **Release.** Sell the selected sword, or the one in hand.
- **Secret manuals.** Spend a written mix of different swords. The clock pauses while the list is open.
- **Fight.** Enemies walk the road to the gate. Swords attack the enemy farthest along the path inside their range. Skills are slash, pierce, area, slow, and formation buff.
- **Waves.** The next wave starts when the prep timer ends. Call it early. Bosses are waves 5, 10, and 15.
- **Loss.** A leaker costs lives. Zero lives ends the run.
- **Win.** Clear wave 15.
- **Record.** Best wave, win count, fastest win, and most kills stay in this browser's `localStorage`.

Tiers are Common, Rare, Epic, Legendary, and Mythic (`일반`, `희귀`, `영웅`, `전설`, `신화`). Summons are 회검, 청명, 적염, 한빙, 진각, and 월흔. 상극검, 삼재검, 새벽베기, and 무정검신 come only from recipes.

## Tuning balance

All numbers live in `js/balance.js`.

| What you want to change | Where |
| --- | --- |
| Starting gold, lives, summon / reroll / awaken costs, prep time | `meta` |
| Tier multipliers | `tiers` |
| Summon odds per awaken level, tiers 1–5 | `weights` |
| Damage, interval, range multiple, skill | `families` |
| Recipe ingredients and results | `recipes` |
| Enemy health, speed, gold, leak damage | `enemies` |
| Wave makeup and the health multiplier for normal enemies | `waves` |

`meta.pathRef / enemies.*.speed` is how many seconds that enemy takes to walk the road. Boss health ignores `hpMul`. In `families`, `range` is how far along the road a sword reaches, in cell widths. 0.6 is short. 1.5 covers most of a row. `splash` and `aura` use that same unit. After `pityEvery` summons in a row with no epic or better, the next summon is at least `pityTier`. Set it to `0` to turn pity off.

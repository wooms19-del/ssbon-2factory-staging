# 📊 정규화된 데이터 모델

> dataLayer.js가 만드는 표준 형식
> 모든 화면이 이 형식으로 데이터를 받아야 함

---

## 정규화된 Packing 객체

```js
{
  // 원본 필드 (그대로 보존)
  _id: 'pk_20260430_181007301',
  date: '2026-04-30',
  product: '미니쇠고기장조림 70g 낱개',
  ea: 10144,
  defect: 802,
  start: '11:40',
  end: '16:50',
  workers: 6,
  machine: '1호기',
  wagon: '6,12,23',
  cart: '',
  wagonDist: {6: 95, 12: 38.2, 23: 90},
  cartDist: {},
  typeKgs: {우둔: 223.2},
  sauceTanks: [{tank:'7번탱크', kg:300}, {tank:'3번탱크', kg:55}],

  // 정규화 추가 필드 (DL.normalizePacking 자동 부착)
  _kgea: 0.024,           // L.products에서 조회
  _isNoMeat: false,       // L.products.noMeat
  _isTestRun: false,      // testRun || isTest
  _typeList: ['우둔'],     // typeKgs > wagon추론 > [] 순으로 결정
  _meatKg: 243.46,        // ea × kgea
  _wagonDistSum: 223.2,   // wagonDist 합
  _typeKgsSum: 223.2,     // typeKgs 합
  _isConsistent: true     // wagonDistSum == typeKgsSum 일치 여부
}
```

## 정규화된 Day 객체

```js
DL.getDay('2026-04-30') = {
  date: '2026-04-30',
  thawing: [...],
  preprocess: [...],
  cooking: [...],
  shredding: [...],
  packing: [...],
  outerpacking: [...],

  summary: {
    rmKgByPart: {우둔: 750.6, 홍두깨: 0, 설도: 0},
    rmKgTotal: 750.6,
    pkEaByPart: {우둔: 12772, 홍두깨: 0, 설도: 0},
    pkEaNoMeat: 4032,
    meatKgByPart: {우둔: 385.37, 홍두깨: 0, 설도: 0},
    meatKgTotal: 385.37,
    yields: {
      원육수율: 0.513,    // meatKgTotal / rmKgTotal
      공정수율: {
        전처리: ...,
        자숙: ...,
        파쇄: ...,
        포장: ...
      }
    },
    workers: {
      preprocess: 7,
      cooking: 2,
      shredding: 14,
      packing: 6
    },
    hours: {
      preprocess: 0.9,
      cooking: 2.8,
      shredding: 1.5,
      packing: 5.2
    }
  },

  validation: {
    errors: [],
    warnings: []
  }
}
```

---

## kgea 정규화 (L.products 단일 출처)

| 제품명 | kgea | noMeat |
|---|---|---|
| 시그니처 장조림 130g | 0.025 | false |
| 코스트코 장조림 170g | 0.054 | false |
| FC 장조림 3KG | 1.3 | false |
| 트레이더스 장조림 460g | 0.147 | false |
| 미니쇠고기장조림 70g 낱개 | 0.024 | false |
| 메추리알 장조림 180g | (값 무관) | **true** |

⚠️ **하드코딩 금지**: 어떤 코드도 0.05 같은 fallback 값 쓰면 안 됨. L.products만 조회.

---

## 부위 (Type) 표준

- 우둔
- 홍두깨
- 설도
- '' (무육)

`L.products[].noMeat === true` 인 제품은 type 자동 추론에서 **반드시 제외**.

---

## 검증 룰

DL.validate(date) 자동 검사 항목:
1. wagonDistSum == typeKgsSum (모든 packing record)
2. shredding.wagonOutDist 합 == sum(packing.wagonDist[해당와곤])
3. noMeat 제품의 typeKgs는 비어있어야 함
4. wagon 번호가 같은 날짜 shredding에 존재해야 함
5. preprocess.kg ≥ cooking.kg ≥ shredding.kg ≥ meatKg (수율 100% 미만)

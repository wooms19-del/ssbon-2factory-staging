"""Firestore -> Supabase 전체 동기화.

사용법:
    python sync/run.py            # 최근 30일만 (기본, 매일 자동 실행용)
    python sync/run.py --all      # 전체 기간 다시
    python sync/run.py --days 90  # 최근 90일

부위 판정은 기존 웹(dataLayer.resolveTypesForPacking)의 규칙을 그대로 옮겼다.
  1) typeKgs 또는 type 필드
  2) 와곤 추적 — 자숙(부위 보유) -> wagonOut -> 파쇄 wagonIn/Out 으로 전파
  3) 그날 자숙이 단일 부위면 그것
  4) 그래도 안 되면 비워 둔다 (추측해서 채우지 않는다)
"""
import sys, os, collections, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

# ── 인자 ─────────────────────────────────────────────
DAYS = 30
if "--all" in sys.argv:
    SINCE = None
elif "--days" in sys.argv:
    DAYS = int(sys.argv[sys.argv.index("--days") + 1])
    SINCE = (datetime.date.today() - datetime.timedelta(days=DAYS)).isoformat()
else:
    SINCE = (datetime.date.today() - datetime.timedelta(days=DAYS)).isoformat()

print(f"[동기화 시작] 범위: {SINCE or '전체'}", flush=True)

# 부위 번호는 item_master 에서 읽어 온다 (하드코딩 금지 — common.py 주석 참고)
PART.update(load_part_map(fetch))
PARTN.update({v: k for k, v in PART.items()})
print("   부위 매핑:", ", ".join(f"{k}={v}" for k, v in sorted(PART.items(), key=lambda x: x[1])), flush=True)

# 기존 웹 제품명 -> 품목 마스터 제품군 (이름이 다른 것만)
ALIAS = {
    "미니쇠고기 장조림 70g 맥스용": "미니쇠고기 장조림 70g 맥스용(5입)",
}


def pg_of(name):
    """기존 웹 제품명을 품목 마스터의 제품군 이름으로 바꾼다."""
    return ALIAS.get(name, name)


# 강제 지정 (관리자 확인분)
FORCE_PART = {
    ("2026-06-17", "코스트코 장조림 170g"): "설도",
    ("2026-06-19", "코스트코 장조림 170g"): "설도",
    ("2026-06-29", "코스트코 장조림 170g"): "설도",
}

# ── 1. 원육 박스 ─────────────────────────────────────
print("1) barcode -> meat_box", flush=True)
bc = fs_all("barcode", SINCE)
rows = []
for o in bc:
    d = dt(o.get("date"), o["_id"], "date")
    if not d:
        continue
    rows.append({
        "src_key": o["_id"], "scan_date": d,
        "part_id": PART.get(o.get("part")), "origin_id": ORIGIN.get(o.get("origin")),
        "weight_kg": o.get("weightKg") or 0,
        "import_code": o.get("importCode"), "trace_code": o.get("traceCode"),
        "pack_date": dt(o.get("packDate"), o["_id"], "packDate"),
        "expiry_date": dt(o.get("expiryDate"), o["_id"], "expiryDate"),
        "rf_start": ts(o.get("rfStart")), "rf_end": ts(o.get("rfEnd")),
        "status": o.get("status"), "reject_reason": o.get("reason"),
    })
upsert("meat_box", rows, "src_key")

# ── 2. 방혈 대차 ─────────────────────────────────────
print("2) thawing -> thaw_cart", flush=True)
th = fs_all("thawing", SINCE)
rows = []
for o in th:
    sd = dt(o.get("start"), o["_id"], "start") or dt(o.get("date"), o["_id"], "date")
    if not sd:
        continue
    rows.append({
        "src_key": o["_id"], "cart_no": str(o.get("cart") or ""),
        "start_date": sd, "finish_date": dt(o.get("end"), o["_id"], "end"),
        "part_id": PART.get(o.get("type") or o.get("part")),
        "box_count": len(o.get("importCodes") or []),
        "total_kg": o.get("totalKg"), "remain_kg": o.get("remainKg"),
        "start_time": ts(o.get("start")), "end_time": ts(o.get("end")),
    })
upsert("thaw_cart", rows, "src_key")

cart = {r["src_key"]: r["cart_id"] for r in fetch("thaw_cart", "src_key,cart_id")}
box = {r["import_code"]: r["box_id"] for r in fetch("meat_box", "import_code,box_id") if r["import_code"]}
links, seen = [], set()
for o in th:
    cid = cart.get(o["_id"])
    if not cid:
        continue
    for code in (o.get("importCodes") or []):
        bid = box.get(code)
        if not bid or (cid, bid) in seen:
            continue
        seen.add((cid, bid))
        links.append({"cart_id": cid, "box_id": bid})
upsert("thaw_cart_box", links, "cart_id,box_id")

# ── 3. 전처리 ────────────────────────────────────────
print("3) preprocess", flush=True)
pp = fs_all("preprocess", SINCE)
rows = []
for o in pp:
    d = dt(o.get("date"), o["_id"], "date")
    if not d:
        continue
    tt = o.get("thawingTouches") or []
    rows.append({
        "src_key": o["_id"], "work_date": d, "cage_no": str(o.get("cage") or ""),
        "part_id": PART.get(o.get("type")),
        "input_kg": round(sum(num(x.get("deductKg")) or 0 for x in tt), 3) or None,
        "output_kg": num(o.get("kg")), "waste_kg": num(o.get("waste")),
        "workers": o.get("workers"),
        "start_time": when(o.get("date"), o.get("start")),
        "end_time": when(o.get("date"), o.get("end")),
    })
upsert("preprocess_run", rows, "src_key")

ppmap = {r["src_key"]: r["pp_id"] for r in fetch("preprocess_run", "src_key,pp_id")}
src, seen = [], set()
for o in pp:
    pid = ppmap.get(o["_id"])
    if not pid:
        continue
    for t in (o.get("thawingTouches") or []):
        cid = cart.get(t.get("thFbId"))
        if not cid or (pid, cid) in seen:
            continue
        seen.add((pid, cid))
        src.append({"pp_id": pid, "cart_id": cid, "used_kg": num(t.get("deductKg")) or 0})
upsert("preprocess_source", src, "pp_id,cart_id")

# ── 4. 자숙 ──────────────────────────────────────────
print("4) cooking", flush=True)
ck = fs_all("cooking", SINCE)
rows = []
for o in ck:
    d = dt(o.get("date"), o["_id"], "date")
    if not d:
        continue
    rows.append({
        "src_key": o["_id"], "work_date": d, "tank_no": str(o.get("tank") or ""),
        "cage_no": str(o.get("cage") or ""), "part_id": PART.get(o.get("type")),
        "input_kg": num(o.get("kgIn")), "output_kg": num(o.get("kg")),
        "workers": o.get("workers"),
        "start_time": when(o.get("date"), o.get("start")),
        "end_time": when(o.get("date"), o.get("end")),
        "note": o.get("note") or None,
    })
upsert("cooking_run", rows, "src_key")

ckmap = {r["src_key"]: r["ck_id"] for r in fetch("cooking_run", "src_key,ck_id")}
w, seen = [], set()
for o in ck:
    cid = ckmap.get(o["_id"])
    if not cid:
        continue
    for fld, dirc in (("wagonInDist", "IN"), ("wagonDist", "OUT")):
        for k, v in (o.get(fld) or {}).items():
            key = (cid, str(k), dirc)
            if key in seen:
                continue
            seen.add(key)
            w.append({"ck_id": cid, "wagon_no": str(k), "kg": num(v) or 0, "direction": dirc})
upsert("cooking_wagon", w, "ck_id,wagon_no,direction")

# ── 5. 파쇄 ──────────────────────────────────────────
print("5) shredding", flush=True)
sh = fs_all("shredding", SINCE)
rows = []
for o in sh:
    d = dt(o.get("date"), o["_id"], "date")
    if not d:
        continue
    rows.append({
        "src_key": o["_id"], "work_date": d, "part_id": PART.get(o.get("type")),
        "input_kg": num(o.get("kgIn")), "washed_kg": num(o.get("kgWashed")),
        "output_kg": num(o.get("kg")), "waste_kg": num(o.get("waste")),
        "workers": o.get("workers"),
        "start_time": when(o.get("date"), o.get("start")),
        "end_time": when(o.get("date"), o.get("end")),
    })
upsert("shredding_run", rows, "src_key")

shmap = {r["src_key"]: r["sh_id"] for r in fetch("shredding_run", "src_key,sh_id")}
w, seen = [], set()
for o in sh:
    sid = shmap.get(o["_id"])
    if not sid:
        continue
    for fld, dirc in (("wagonInDist", "IN"), ("wagonOutDist", "OUT")):
        for k, v in (o.get(fld) or {}).items():
            key = (sid, str(k), dirc)
            if key in seen:
                continue
            seen.add(key)
            w.append({"sh_id": sid, "wagon_no": str(k), "kg": num(v) or 0, "direction": dirc})
upsert("shredding_wagon", w, "sh_id,wagon_no,direction")

# ── 6. 소스 ──────────────────────────────────────────
print("6) sauce", flush=True)
sc = fs_all("sauce", SINCE)
rows = [{"src_key": o["_id"], "work_date": dt(o.get("date"), o["_id"], "date"),
         "tank_no": str(o.get("tank") or ""), "kg": num(o.get("kg")),
         "sauce_name": o.get("name"), "note": o.get("note") or None}
        for o in sc if dt(o.get("date"))]
upsert("sauce_batch", rows, "src_key")

# ── 7. 부위 판정 준비 (와곤 -> 부위) ─────────────────
print("7) 부위 판정", flush=True)
ALL_CK = fs_all("cooking")
ALL_SH = fs_all("shredding")


def istest(o):
    return bool(o.get("isTest") or o.get("testRun") or o.get("test"))


_MAPS = {}


def maps(date):
    """그날의 와곤->부위 지도.

    대차 번호는 한정돼 있어 하루에 재사용된다. 실제로 자숙 대차를 두 부위가
    같은 날 쓰는 사례가 있어, 번호 하나에 부위 하나로 두면 나중 것이 버려진다.
    그래서 번호별로 후보를 모두 담고, 쓸 때 무게·시각으로 고른다.
    """
    if date in _MAPS:
        return _MAPS[date]
    ck_d = [c for c in ALL_CK if dt(c.get("date")) == date and not istest(c)]
    sh_d = [s for s in ALL_SH if dt(s.get("date")) == date and not istest(s)]

    def add(m, wn, part, end, kg):
        m.setdefault(wn, []).append({"part": part, "end": end or "", "kg": kg or 0.0})

    ckW = {}
    for c in ck_d:
        t = (c.get("type") or "").strip()
        if not t:
            continue
        od = c.get("wagonOutDist") or {}
        for wn in wagons(c.get("wagonOut")):
            add(ckW, wn, t, c.get("end"), num(od.get(wn)) or num(c.get("kg")))
    shW = {}
    for s in sh_d:
        od = s.get("wagonOutDist") or {}
        washed = num(s.get("kgWashed")) or num(s.get("kg")) or 0.0
        osum = sum(num(v) or 0 for v in od.values()) if od else 0.0
        own = (s.get("type") or "").strip()
        if own not in PART:
            inT, dist = {}, (s.get("wagonInDist") or {})
            for wn in wagons(s.get("wagonIn")):
                t = pick(ckW, wn)
                if not t:
                    continue
                inT[t] = inT.get(t, 0) + (num(dist.get(wn)) or 1)
            own = sorted(inT, key=lambda k: -inT[k])[0] if inT else ""
        if not own:
            continue
        for wn in wagons(s.get("wagonOut")):
            # 포장이 받는 건 세척 후 무게이므로 세척 후 기준으로 환산해 둔다
            kg = washed * ((num(od.get(wn)) or 0) / osum) if osum > 0 else washed
            add(shW, wn, own, s.get("end"), kg)

    types = sorted({(c.get("type") or "").strip() for c in ck_d if (c.get("type") or "").strip()})
    _MAPS[date] = (shW, ckW, types)
    return _MAPS[date]


def pick(m, wn, use_kg=0.0, before=None):
    """와곤 번호의 부위. 후보가 여럿이면 무게 > 시각 순으로 고른다."""
    c = m.get(str(wn))
    if not c:
        return None
    if len(c) == 1:
        return c[0]["part"]
    if use_kg > 0:
        hit = [x for x in c if abs(x["kg"] - use_kg) < 0.5]
        if len(hit) == 1:
            return hit[0]["part"]
        if hit:
            c = hit
    ordered = sorted(c, key=lambda x: x["end"])
    if before:
        prev = [x for x in ordered if x["end"] and x["end"] <= before]
        if prev:
            return prev[-1]["part"]
    return ordered[-1]["part"]


items = fetch("item_master", "item_id,product_group,part,category,no_meat")
IM, IM_NOMEAT, AVAIL = {}, {}, collections.defaultdict(set)
for i in items:
    if i["category"] != "완제품":
        continue
    if i.get("no_meat"):
        IM_NOMEAT[i["product_group"]] = i["item_id"]
    if i["part"]:
        IM[(i["product_group"], i["part"])] = i["item_id"]
        AVAIL[i["product_group"]].add(i["part"])
    elif not i.get("no_meat"):
        IM_NOMEAT.setdefault(i["product_group"], i["item_id"])

UNRESOLVED = []
MISMATCH = []   # typeKgs 수동입력과 대차 추적이 어긋난 건
NOPART = []     # item_master 에 없는 부위


def part_kg(o):
    """부위별 투입 kg. 근거: wagonDist×와곤부위 > typeKgs > 단일판정.

    대차 추적(wagonDist)이 파쇄 기록과 직접 연결되므로 가장 믿을 수 있다.
    typeKgs 는 현장 수동 입력이라 실제 대차 흐름과 어긋나는 사례가 있어 뒤로 둔다.
    """
    d, prod = dt(o.get("date")), pg_of(o.get("product") or "")
    tk = {k: float(v) for k, v in (o.get("typeKgs") or {}).items()
          if k in PART and float(v or 0) > 0}
    if d:
        shW, ckW, types = maps(d)
        acc = collections.defaultdict(float)
        start = o.get("start")
        for wn, kg in (o.get("wagonDist") or {}).items():
            v = num(kg) or 0
            t = pick(shW, wn, v, start) or pick(ckW, wn, v, start)
            if t:
                acc[t] += v
        if acc and sum(acc.values()) > 0:
            # 수동 입력(typeKgs)과 부위 구성이 다르면 기록만 남기고 대차 추적을 따른다.
            if tk and set(tk) != set(acc):
                MISMATCH.append({
                    "date": d, "product": prod,
                    "typeKgs": dict(tk), "wagonDist": dict(acc),
                })
            return dict(acc), "wagonDist"
    if tk:
        return tk, "typeKgs"
    if d:
        shW, ckW, types = maps(d)
        got = set()
        for wn in wagons(o.get("wagon")):
            t = pick(shW, wn, 0.0, o.get("start")) or pick(ckW, wn, 0.0, o.get("start"))
            if t:
                got.add(t)
        f = FORCE_PART.get((d, prod))
        if f:
            return {f: 0.0}, "관리자지정"
        t2 = (o.get("type") or "").strip()
        if t2 in PART:
            return {t2: 0.0}, "type"
        if len(got) == 1:
            return {got.pop(): 0.0}, "wagon"
        if len(types) == 1:
            return {types[0]: 0.0}, "단일부위일"
        cand = (got or set(types)) & AVAIL.get(prod, set())
        if len(cand) == 1:
            return {cand.pop(): 0.0}, "제품가능부위"
    return {}, "미해결"


def split_ea(total, parts):
    """kg 비율로 EA 분배. 합계가 원본과 정확히 맞도록 잔여는 최대 항목이 흡수."""
    total = integer(total) or 0
    ks = list(parts)
    if not ks:
        return {}
    s = sum(parts.values())
    if s <= 0 or len(ks) == 1:
        out = {ks[0]: total}
        for k in ks[1:]:
            out[k] = 0
        return out
    out, run = {}, 0
    order = sorted(ks, key=lambda k: -parts[k])
    for k in order[1:]:
        v = int(round(total * parts[k] / s))
        out[k] = v
        run += v
    out[order[0]] = total - run
    return out


# ── 8. 내포장 ────────────────────────────────────────
print("8) packing", flush=True)
pk = fs_all("packing", SINCE)
rows = []
for o in pk:
    d = dt(o.get("date"), o["_id"], "date")
    if not d:
        continue
    rows.append({
        "src_key": o["_id"], "work_date": d,
        "machine_no": str(o.get("machine") or "")[:10],
        "ea": integer(o.get("ea")), "defect": integer(o.get("defect")),
        "pouch": integer(o.get("pouch")), "sauce_kg": num(o.get("sauceKg")),
        "sub_name": o.get("subName") or None, "sub_kg": num(o.get("subKg")),
        "workers": integer(o.get("workers")),
        "start_time": when(o.get("date"), o.get("start")),
        "end_time": when(o.get("date"), o.get("end")),
    })
upsert("packing_run", rows, "src_key")

pkmap = {r["src_key"]: r["pk_id"] for r in fetch("packing_run", "src_key,pk_id")}
w, seen = [], set()
for o in pk:
    pid = pkmap.get(o["_id"])
    if not pid:
        continue
    for k, v in (o.get("wagonDist") or {}).items():
        key = (pid, str(k)[:10])
        if key in seen:
            continue
        seen.add(key)
        w.append({"pk_id": pid, "wagon_no": str(k)[:10], "kg": num(v) or 0})
upsert("packing_wagon", w, "pk_id,wagon_no")

parts_rows, PKSPLIT, stat = [], {}, collections.Counter()
for o in pk:
    pid = pkmap.get(o["_id"])
    if not pid:
        continue
    d, prod = dt(o.get("date")), pg_of(o.get("product") or "")
    if not prod:
        continue
    if prod in IM_NOMEAT and prod not in AVAIL:
        stat["무육"] += 1
        continue
    pkk, srcname = part_kg(o)
    stat[srcname] += 1
    if not pkk:
        UNRESOLVED.append((d, prod, "내포장"))
        continue
    eas = split_ea(o.get("ea"), pkk)
    PKSPLIT[(prod, d)] = dict(eas)
    for pn, kg in pkk.items():
        if pn not in PART:
            # 마스터에 없는 부위. 임의 번호로 넣으면 엉뚱한 품목이 되므로 건너뛴다.
            NOPART.append((d, prod, pn))
            continue
        parts_rows.append({"pk_id": pid, "part_id": PART[pn],
                           "item_id": IM.get((prod, pn)),
                           "input_kg": round(kg, 3) if kg else None,
                           "ea": eas.get(pn, 0)})
upsert("packing_part", parts_rows, "pk_id,part_id")

# ── 9. 외포장 · 레토르트 ─────────────────────────────
print("9) outerpacking / retort", flush=True)


def inherit(prod, d):
    if (prod, d) in PKSPLIT:
        return PKSPLIT[(prod, d)]
    ks = sorted([k[1] for k in PKSPLIT if k[0] == prod and k[1] <= d], reverse=True)
    return PKSPLIT[ks and (prod, ks[0])] if ks else {}


op = fs_all("outerpacking", SINCE)
rows = []
for o in op:
    d = dt(o.get("date"), o["_id"], "date")
    if not d:
        continue
    rows.append({
        "src_key": o["_id"][:60], "work_date": d,
        "inner_ea": integer(o.get("innerEa")), "outer_ea": integer(o.get("outerEa")),
        "outer_boxes": integer(o.get("outerBoxes")),
        "partial_box_ea": integer(o.get("partialBoxEa")),
        "remain_ea": integer(o.get("remainEa")), "sample_ea": integer(o.get("sample")),
        "product_defect": integer(o.get("productDefect")),
        "tray_used": integer(o.get("trayUsed")), "tray_defect": integer(o.get("trayDefect")),
        "stock_reg": bool(o.get("stockReg")), "test_run": bool(o.get("testRun")),
        "note": o.get("note") or None,
    })
upsert("outerpacking_run", rows, "src_key")

opmap = {r["src_key"]: r["op_id"] for r in fetch("outerpacking_run", "src_key,op_id")}
logs, seen = [], set()
for o in op:
    oid = opmap.get(o["_id"][:60])
    if not oid:
        continue
    for i, l in enumerate(o.get("workLogs") or [], 1):
        if (oid, i) in seen:
            continue
        seen.add((oid, i))
        logs.append({"op_id": oid, "seq": i,
                     "start_time": when(o.get("date"), l.get("start")),
                     "end_time": when(o.get("date"), l.get("end")),
                     "workers": integer(l.get("workers"))})
upsert("outerpacking_worklog", logs, "op_id,seq")

rt = fs_all("retort", SINCE)
rows = []
for o in rt:
    d = dt(o.get("date"), o["_id"], "date")
    if not d:
        continue
    rows.append({
        "src_key": o["_id"], "work_date": d,
        "machine_no": str(o.get("machine") or "")[:10],
        "round_no": integer(o.get("round")), "ea": integer(o.get("ea")),
        "batch": str(o.get("batch") or "")[:50],
        "ccp_type": (str(o.get("ccp") or "")[:1] or None),
        "temp": num(o.get("temp")),
        "t1": tm(o.get("t1")), "t2": tm(o.get("t2")),
        "t3": tm(o.get("t3")), "t4": tm(o.get("t4")),
    })
upsert("retort_run", rows, "src_key")

for coll, table, key, ptab, eaf, docs in [
        ("outerpacking", "outerpacking_run", "op_id", "outerpacking_part", "outerEa", op),
        ("retort", "retort_run", "rt_id", "retort_part", "ea", rt)]:
    m = {r["src_key"]: (r[key], r["work_date"]) for r in fetch(table, f"src_key,{key},work_date")}
    rr, miss = [], 0
    for o in docs:
        ent = m.get(o["_id"][:60])
        if not ent:
            continue
        oid, d = ent
        prod = pg_of(o.get("product") or "")
        if not prod:
            continue
        if prod in IM_NOMEAT and prod not in AVAIL:
            continue
        base = inherit(prod, d)
        if not base:
            miss += 1
            UNRESOLVED.append((d, prod, ptab))
            continue
        eas = split_ea(o.get(eaf), {k: max(v, 1) for k, v in base.items()})
        for pn, ea in eas.items():
            if pn not in PART:
                NOPART.append((d, prod, pn))
                continue
            rr.append({key: oid, "part_id": PART[pn], "item_id": IM.get((prod, pn)), "ea": ea})
    upsert(ptab, rr, f"{key},part_id")

# ── 10. 작업자 · 출퇴근 ──────────────────────────────
print("10) attendance", flush=True)
at = fs_all("attendance", SINCE)
names = sorted({n for o in at for n in (o.get("records") or {})})
upsert("worker", [{"name": n, "role": "production", "active": True} for n in names], "name")
wk = {r["name"]: r["worker_id"] for r in fetch("worker", "worker_id,name")}
rows, seen = [], set()
for o in at:
    d = dt(o.get("date") or o["_id"], o["_id"], "date")
    if not d:
        continue
    for n, v in (o.get("records") or {}).items():
        wid = wk.get(n)
        if not wid or (d, wid) in seen:
            continue
        seen.add((d, wid))
        rows.append({"work_date": d, "worker_id": wid,
                     "time_in": tm(v.get("inTime")), "time_out": tm(v.get("outTime"))})
upsert("attendance", rows, "work_date,worker_id")

# ── 결과 ─────────────────────────────────────────────
print("\n=== 적재 결과 ===", flush=True)
for k in sorted(STATS):
    print(f"  {k:<24} {STATS[k]:>7}", flush=True)
print(f"\n부위 판정: {dict(stat)}", flush=True)
if UNRESOLVED:
    print(f"\n부위 미해결 {len(UNRESOLVED)}건:", flush=True)
    for x in UNRESOLVED[:20]:
        print("   ", x, flush=True)
if MISMATCH:
    print(f"\n부위 수동입력(typeKgs)과 대차 추적이 다른 건 {len(MISMATCH)}건 — 대차 추적을 따랐습니다:", flush=True)
    for x in MISMATCH[:20]:
        tk = ", ".join(f"{k} {v:g}" for k, v in x["typeKgs"].items())
        wd = ", ".join(f"{k} {v:g}" for k, v in x["wagonDist"].items())
        print(f"    {x['date']} {x['product']}  입력[{tk}]  실제[{wd}]", flush=True)

# ── 부위 배분 총량 대조 ───────────────────────────────
# 날짜·부위별로 "포장이 받은 양"과 "파쇄가 내보낸 양(세척 후)"을 비교한다.
# 대차 판정이 한쪽으로 몰리거나 새면 여기서 드러난다.
# 4~9월 실적으로는 5% 기준에서도 0건이라, 뜨면 실제 신호로 봐도 된다.
def audit_parts():
    days = sorted({dt(o.get("date")) for o in pk if not istest(o)})
    bad = []
    for d in days:
        shW, ckW, _ = maps(d)
        got = collections.defaultdict(float)
        for o in pk:
            if dt(o.get("date")) != d or istest(o):
                continue
            start = o.get("start")
            for wn, kg in (o.get("wagonDist") or {}).items():
                v = num(kg) or 0
                t = pick(shW, wn, v, start) or pick(ckW, wn, v, start)
                if t:
                    got[t] += v
        made = collections.defaultdict(float)
        for s in ALL_SH:
            if dt(s.get("date")) != d or istest(s):
                continue
            t = (s.get("type") or "").strip()
            if t:
                made[t] += num(s.get("kgWashed")) or num(s.get("kg")) or 0
        for t in set(got) | set(made):
            a, b = got.get(t, 0), made.get(t, 0)
            if b > 0 and abs(a - b) / b > 0.05:
                bad.append((d, t, a, b, (a - b) / b * 100))
    return bad

AUDIT = audit_parts()
if AUDIT:
    print(f"\n부위 배분 점검 — 포장이 받은 양과 파쇄 산출이 5% 넘게 다른 건 {len(AUDIT)}건:", flush=True)
    print("  (이월·잔여면 정상. 한쪽 부위로 몰렸는지 확인이 필요한 신호다)", flush=True)
    for d, t, a, b, r in AUDIT[:20]:
        print(f"    {d} {t}: 포장 {a:,.1f} vs 파쇄 {b:,.1f} ({r:+.1f}%)", flush=True)
else:
    print("\n부위 배분 점검: 이상 없음", flush=True)

if NOPART:
    kinds = sorted({x[2] for x in NOPART})
    print(f"\nitem_master 에 없는 부위 {len(NOPART)}건 — 건너뛰었습니다: {', '.join(kinds)}", flush=True)
    print("  해당 부위를 item_master 에 원육으로 등록해야 실적에 잡힙니다.", flush=True)
    for x in NOPART[:10]:
        print(f"    {x[0]} {x[1]} — {x[2]}", flush=True)
if BADDATE:
    print(f"\n날짜 이상으로 비운 값 {len(BADDATE)}건", flush=True)
    for x in BADDATE[:10]:
        print("   ", x, flush=True)
print("\n[동기화 완료]", flush=True)

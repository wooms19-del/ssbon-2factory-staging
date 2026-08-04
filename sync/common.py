"""Firestore -> Supabase 동기화 공통부.

읽기는 Firestore, 쓰기는 Supabase REST 만 쓴다.
Supabase Management API 는 insert/delete 가 WAF(error 1010)에 막히므로
데이터 적재는 반드시 rest/v1 경로를 쓴다.

모든 적재는 src_key(원본 문서 ID) 기준 upsert 이므로
몇 번을 다시 돌려도 중복이 생기지 않는다.
"""
import os, json, time, datetime, urllib.request, urllib.parse, urllib.error

FB_KEY = os.environ["FIREBASE_API_KEY"]
SB_URL = os.environ["SUPABASE_URL"].rstrip("/")
SB_KEY = os.environ["SUPABASE_KEY"]

FB = "https://firestore.googleapis.com/v1/projects/ssbon-factory/databases/(default)/documents"
RB = SB_URL + "/rest/v1"

BADDATE = []
STATS = {}


# ── Firestore ────────────────────────────────────────
def fs_all(coll, since=None):
    """컬렉션 전체를 읽는다. since 가 있으면 date >= since 인 문서만 남긴다."""
    out, tok = [], None
    while True:
        u = f"{FB}/{coll}?key={FB_KEY}&pageSize=300"
        if tok:
            u += "&pageToken=" + urllib.parse.quote(tok)
        for attempt in range(3):
            try:
                with urllib.request.urlopen(u, timeout=90) as r:
                    d = json.load(r)
                break
            except Exception as e:
                if attempt == 2:
                    raise
                time.sleep(3)
        out += d.get("documents", [])
        tok = d.get("nextPageToken")
        if not tok:
            break
    docs = [doc(x) for x in out]
    if since:
        docs = [o for o in docs if str(o.get("date") or "")[:10] >= since]
    return docs


def val(v):
    if v is None:
        return None
    if "stringValue" in v: return v["stringValue"]
    if "doubleValue" in v: return v["doubleValue"]
    if "integerValue" in v: return int(v["integerValue"])
    if "booleanValue" in v: return v["booleanValue"]
    if "timestampValue" in v: return v["timestampValue"]
    if "arrayValue" in v: return [val(x) for x in v["arrayValue"].get("values", [])]
    if "mapValue" in v: return {k: val(x) for k, x in v["mapValue"].get("fields", {}).items()}
    return None


def doc(d):
    o = {k: val(v) for k, v in d.get("fields", {}).items()}
    o["_id"] = d["name"].split("/")[-1]
    return o


# ── Supabase REST ────────────────────────────────────
def _req(method, path, body=None, prefer=None, timeout=180):
    h = {"apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY,
         "Content-Type": "application/json"}
    if prefer:
        h["Prefer"] = prefer
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(RB + path, data=data, headers=h, method=method)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            msg = e.read()[:400].decode(errors="replace")
            if attempt == 2:
                raise RuntimeError(f"{method} {path[:60]} -> {e.code} {msg}")
            time.sleep(3)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(3)


def upsert(table, rows, conflict, chunk=500):
    if not rows:
        return 0
    n = 0
    for i in range(0, len(rows), chunk):
        _req("POST", f"/{table}?on_conflict={conflict}", rows[i:i + chunk],
             "resolution=merge-duplicates,return=minimal")
        n += len(rows[i:i + chunk])
    STATS[table] = STATS.get(table, 0) + n
    return n


def fetch(table, select, chunk=1000):
    out, off = [], 0
    while True:
        d = _req("GET", f"/{table}?select={select}&limit={chunk}&offset={off}") or []
        out += d
        if len(d) < chunk:
            break
        off += chunk
    return out


def patch(table, filt, body):
    _req("PATCH", f"/{table}?{filt}", body, "return=minimal", timeout=60)


# ── 값 변환 ──────────────────────────────────────────
def dt(s, src=None, field=None):
    """날짜. 잘못된 값은 비우고 BADDATE 에 기록한다 (지어내지 않는다)."""
    if not s:
        return None
    v = str(s)[:10]
    try:
        datetime.date.fromisoformat(v)
        return v
    except Exception:
        BADDATE.append((src, field, str(s)))
        return None


def ts(s):
    if not s:
        return None
    v = str(s).replace("T", " ").replace("Z", "")
    return v[:19] if len(v) >= 16 else None


def when(date, t):
    d = dt(date)
    if not d or not t:
        return None
    t = str(t).strip()
    return f"{d} {t}:00" if (len(t) == 5 and ":" in t) else ts(t)


def tm(t):
    t = str(t or "").strip()
    return f"{t}:00" if (len(t) == 5 and ":" in t) else None


def num(v):
    try:
        return float(v)
    except Exception:
        return None


def integer(v):
    try:
        return int(float(v))
    except Exception:
        return None


def wagons(s):
    return [x.strip() for x in str(s or "").replace("，", ",").split(",") if x.strip()]


PART = {"홍두깨": 1, "설도": 2, "우둔": 3, "설깃": 4}
PARTN = {1: "홍두깨", 2: "설도", 3: "우둔", 4: "설깃"}
ORIGIN = {"호주": 1, "뉴질랜드": 2}

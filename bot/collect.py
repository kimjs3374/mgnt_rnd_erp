"""공고 수집 실행기 — MCP 도구가 「받아오라」는 말을 실제 수집으로 바꾸는 층.

**왜 여기서 다시 긁지 않는가.** 수집 로직은 이미 `/web/rnd/scripts/collect-*.mjs` 에 있고
화면(공고 탐색 보드)이 보는 것과 같은 코드다. 파이썬으로 한 벌 더 만들면 두 벌이 갈리고,
갈리면 챗봇이 답한 건수와 화면 건수가 달라진다. **이 파일은 그 스크립트를 띄우고 지켜볼 뿐이다.**

**MCP 서버는 읽기 전용 계정(`rnd_mcp`)으로 DB 에 붙는다.** 쓰기는 수집 스크립트가
PostgREST(service_role)로 한다 — 도구가 임의로 DB 를 고칠 길이 여기에도 안 생긴다.

⚠ **수집은 초가 아니라 분 단위다.** 첨부 다운로드 + `claude -p` 판독이 건당 수십 초다.
   그래서 백그라운드로 띄우고(`start_new_session=True`) `wait_seconds` 만큼만 기다린다.
   못 끝나면 run_id 를 돌려주고 `collect_progress` 로 이어 본다 —
   **도구 호출이 타임아웃으로 끊겨도 수집은 계속 돈다.**

⚠ 같은 출처를 두 번 동시에 돌리지 않는다. 같은 행을 양쪽에서 upsert 하는 것도 문제지만,
   진짜 이유는 한도다 — 헤드리스 호출이 두 배로 나간다.
"""

import json
import os
import signal
import subprocess
import time
from datetime import datetime, timezone

WEB = "/web/rnd"
RUN_DIR = "/rnd/data/collect"  # 로그는 저장소 밖에 둔다. git 에 들어가면 안 된다.

# 출처마다 인자 뜻이 다르다. 그 차이를 도구 설명에 그대로 적어 두고, 여기서 한 곳으로 모은다.
SOURCES: dict[str, dict] = {
    "IRIS": {
        "script": "scripts/collect-iris.mjs",
        "단위": "공고 건수",
        "설명": "범부처 국가R&D 공고. 상세페이지에 공고문(HWP/PDF)이 붙어 있어 제출서류까지 판독된다.",
        "llm": True,
    },
    "NTIS": {
        "script": "scripts/collect-ntis.mjs",
        "단위": "과제 건수",
        "설명": "국가R&D 과제검색 오픈API. 접수기간·공고문이 없는 참고 정보라 마감유형='정보성'으로 들어간다.",
        "llm": False,
    },
    "기업마당": {
        "script": "scripts/collect-bizinfo.mjs",
        "단위": "정밀파싱 건수(나머지는 목록만 저장)",
        "설명": "중소벤처기업부 기업마당 공식 오픈API. 회사 프로필로 1차 거른 뒤 그 건만 첨부를 판독한다.",
        "llm": True,
    },
    "K-Startup": {
        "script": "scripts/collect-kstartup.mjs",
        "단위": "공고 건수(100건 단위 페이지로 환산)",
        "설명": "창업진흥원 공식 오픈API. 지역·접수일자를 정제된 필드로 주므로 목록 수집 하나로 끝난다.",
        "llm": False,
    },
}

_별칭 = {
    "iris": "IRIS",
    "ntis": "NTIS",
    "bizinfo": "기업마당",
    "기업마당": "기업마당",
    "kstartup": "K-Startup",
    "k-startup": "K-Startup",
    "케이스타트업": "K-Startup",
}


def 출처정규화(source: str) -> str | None:
    s = (source or "").strip()
    if s in SOURCES:
        return s
    return _별칭.get(s.lower())


def _args(source: str, limit: int, keyword: str) -> list[str]:
    if source == "NTIS":
        # collect-ntis.mjs [검색어] [최대건수]
        return [SOURCES[source]["script"], keyword or "연구개발", str(limit)]
    if source == "K-Startup":
        # collect-kstartup.mjs [최대 페이지] — 한 페이지가 100건이다.
        return [SOURCES[source]["script"], str(max(1, -(-limit // 100)))]
    return [SOURCES[source]["script"], str(limit)]


def _run_dir() -> str:
    os.makedirs(RUN_DIR, exist_ok=True)
    return RUN_DIR


def log_path(run_id: str) -> str:
    return os.path.join(_run_dir(), f"{run_id}.log")


def meta_path(run_id: str) -> str:
    return os.path.join(_run_dir(), f"{run_id}.json")


def _write_meta(meta: dict) -> None:
    with open(meta_path(meta["run_id"]), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


def read_meta(run_id: str) -> dict | None:
    try:
        with open(meta_path(run_id), encoding="utf-8") as f:
            return json.load(f)
    except OSError:
        return None


def latest_meta(source: str = "") -> dict | None:
    """가장 최근에 시작한 수집. source 를 주면 그 출처의 것만 본다."""
    metas = []
    for name in os.listdir(_run_dir()) if os.path.isdir(RUN_DIR) else []:
        if not name.endswith(".json"):
            continue
        m = read_meta(name[:-5])
        if m and (not source or m.get("source") == source):
            metas.append(m)
    if not metas:
        return None
    return max(metas, key=lambda m: m.get("started_at", ""))


_자식: dict[int, subprocess.Popen] = {}  # 이 프로세스가 띄운 것. poll() 로 거둬야 좀비가 안 남는다.


def 살아있나(pid: int) -> bool:
    """프로세스가 아직 도는지.

    ⚠ `os.kill(pid, 0)` 으로 보면 안 된다. 끝난 자식을 부모가 안 거두면 **좀비로 남고,
      좀비도 신호 검사를 통과한다** — 실측(2026-09-03): NTIS 수집이 몇 초 만에 끝났는데
      도구가 60초 내내 「진행중」이라고 답했다. `/proc/<pid>/stat` 의 상태 문자를 본다.
      (상태 문자 앞의 실행파일 이름에 괄호·공백이 들어갈 수 있어 마지막 ')' 뒤부터 자른다.)
    """
    try:
        p = _자식.get(pid)
        if p is not None and p.poll() is not None:
            return False  # 여기서 거둬진다
        with open(f"/proc/{pid}/stat", encoding="utf-8") as f:
            상태 = f.read().rsplit(")", 1)[1].split()[0]
    except (OSError, IndexError, TypeError, ValueError):
        return False
    return 상태 != "Z"


def 진행중(source: str = "") -> dict | None:
    """아직 돌고 있는 수집이 있으면 그 meta 를 돌려준다."""
    for name in os.listdir(_run_dir()) if os.path.isdir(RUN_DIR) else []:
        if not name.endswith(".json"):
            continue
        m = read_meta(name[:-5])
        if not m or m.get("finished_at"):
            continue
        if source and m.get("source") != source:
            continue
        if 살아있나(m.get("pid", -1)):
            return m
    return None


def tail(path: str, n: int = 15) -> str:
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            lines = [ln.rstrip() for ln in f.readlines() if ln.strip()]
    except OSError:
        return ""
    return "\n".join(lines[-n:])


def _env() -> dict:
    """헤드리스 `claude` 를 찾을 PATH 와 구독 로그인이 들어 있는 HOME 을 반드시 넘긴다.

    ⚠ HOME 이 없으면 `claude -p` 가 로그인을 못 찾아 조용히 빈 응답을 낸다 —
      llm.mjs 가 ok:false 로 삼켜서 「서류 0건」으로만 보인다. 원인 찾기 최악이라 여기서 막는다.
    """
    env = dict(os.environ)
    path = env.get("PATH", "")
    for p in ("/usr/local/bin", "/usr/bin", "/bin"):
        if p not in path.split(":"):
            path = f"{path}:{p}" if path else p
    env["PATH"] = path
    env.setdefault("HOME", os.path.expanduser("~"))
    return env


def start(source: str, limit: int, keyword: str = "", db_since: str = "") -> dict:
    """수집 스크립트를 백그라운드로 띄운다. 즉시 meta 를 돌려준다.

    db_since 는 **DB 서버의 현재 시각**이다(호출부가 `select now()` 로 읽어 넘긴다).
    이 시각 뒤에 생긴 announcements 행이 이번 수집으로 새로 들어온 것이다.
    파이썬 쪽 시계를 쓰지 않는 이유는 컨테이너와 호스트의 시계가 어긋나면
    「새로 받은 건수」가 조용히 틀리기 때문이다.
    """
    run_id = f"{source}-{datetime.now().strftime('%m%d-%H%M%S')}".replace(" ", "")
    started = datetime.now(timezone.utc).isoformat()
    lp = log_path(run_id)
    with open(lp, "w", encoding="utf-8") as log:
        log.write(f"# {run_id} · node {' '.join(_args(source, limit, keyword))}\n")
        log.flush()
        p = subprocess.Popen(
            ["node", *_args(source, limit, keyword)],
            cwd=WEB,
            stdout=log,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            env=_env(),
            start_new_session=True,  # 도구 호출이 끊겨도 수집은 계속 돈다
        )
    _자식[p.pid] = p
    meta = {
        "run_id": run_id,
        "source": source,
        "limit": limit,
        "keyword": keyword,
        "pid": p.pid,
        "started_at": started,
        "db_since": db_since,
        "finished_at": None,
        "returncode": None,
    }
    _write_meta(meta)
    return meta


def wait(meta: dict, wait_seconds: int) -> dict:
    """wait_seconds 까지만 기다린다. 그 안에 끝나면 meta 에 종료 정보를 채워 돌려준다."""
    deadline = time.time() + max(0, wait_seconds)
    while time.time() < deadline:
        if not 살아있나(meta["pid"]):
            break
        time.sleep(1)
    return refresh(meta)


def refresh(meta: dict) -> dict:
    """프로세스가 끝났으면 meta 를 한 번만 갱신해 저장한다.

    ⚠ 종료코드는 **이 프로세스가 띄운 수집에서만** 얻는다. 다른 MCP 세션이 띄운 것을
      collect_progress 로 들여다보면 남의 자식이라 exit status 를 읽을 길이 없다 —
      그 자리에 0(성공)을 채워 넣지 않는다. null 로 두고 로그 끝을 근거로 읽는다.
    """
    if meta.get("finished_at") or 살아있나(meta.get("pid", -1)):
        return meta
    p = _자식.pop(meta.get("pid", -1), None)
    if p is not None:
        meta["returncode"] = p.poll()
    meta["finished_at"] = datetime.now(timezone.utc).isoformat()
    _write_meta(meta)
    return meta


def 경과초(meta: dict) -> int:
    시작 = datetime.fromisoformat(meta["started_at"])
    끝 = datetime.fromisoformat(meta["finished_at"]) if meta.get("finished_at") else datetime.now(timezone.utc)
    return int((끝 - 시작).total_seconds())


def stop(run_id: str) -> bool:
    """돌고 있는 수집을 멈춘다. 세션 전체(node + 자식 claude)를 같이 내린다."""
    meta = read_meta(run_id)
    if not meta or not 살아있나(meta.get("pid", -1)):
        return False
    try:
        os.killpg(os.getpgid(meta["pid"]), signal.SIGTERM)
    except OSError:
        return False
    return True

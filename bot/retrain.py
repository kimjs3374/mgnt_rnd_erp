#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""비목 모델 재학습 — **사람이 확정한 것으로 모델을 갱신한다.**  LLM 0회.

이 파일이 「쌓이면 좋아진다」의 실체다. 없으면 판단 이력은 그냥 로그일 뿐이다.

    Slack 확정/정정  →  app.decisions + app.expenses  →  (여기)  →  새 모델
                                                              ↓
                                                    app.model_versions 에 기록
                                                    /rnd/bot/models/ 에 저장

핵심 설계
  · **씨앗 + 실적**을 같이 학습한다. 사내 실집행 772파일에서 뽑은 씨앗(79건)만으로는
    처음 며칠이 약하고, 실적만으로는 데이터가 모자란다. 둘을 합치되 실적에 무게를 준다.
  · **정정 건에 가중치를 더 준다.** 서식 축 실측에서 정정 우선 학습이 무작위보다 +2.6p 였다.
    사람이 고친 곳이 모델이 약한 곳이다.
  · **동의(정정여부=false)도 학습에 넣는다.** 「AI 가 맞았다」는 것도 신호다.
  · 평가는 **거래처 그룹 분리**로 한다. 거래처를 외워 맞히면 처음 보는 거래처에 쓸모없다.
  · 새 모델이 **기존보다 나쁘면 배포하지 않는다.** 나빠진 모델을 조용히 밀어넣지 않는다.

실행:  /rnd/bot/venv/bin/python /web/rnd/bot/retrain.py [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from collections import Counter
from datetime import datetime, timezone

import numpy as np
import psycopg
import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.model_selection import StratifiedGroupKFold, cross_val_predict

DSN = os.environ["RND_DSN"]
MODELS = os.environ.get("RND_MODEL_DIR", "/rnd/bot/models")
ACTIVE = os.path.join(MODELS, "bimok_item_v2.joblib")     # 봇이 읽는 경로
SEED = os.path.join(MODELS, "bimok_seed.jsonl")           # 씨앗 학습셋(772파일에서 추출)
CORRECTION_WEIGHT = float(os.environ.get("RND_CORRECTION_WEIGHT", "3.0"))
MIN_NEW = int(os.environ.get("RND_RETRAIN_MIN", "5"))     # 실적이 이만큼은 쌓여야 돌린다


def q(sql: str, params: tuple = ()) -> list[dict]:
    with psycopg.connect(DSN, connect_timeout=5) as c, c.cursor() as cur:
        cur.execute(sql, params)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def load_실적() -> list[dict]:
    """사람이 확정한 집행. 품목이 있으면 품목을, 없으면 거래처를 특징으로 쓴다.

    ⚠ 무엇을 샀는가(품목)가 비목을 정한다. 카드전표처럼 품목이 인쇄되지 않는 서식만
      거래처(가맹점)를 쓴다 — 그 경우 가맹점이 유일한 근거다.
    """
    rows = q(
        """
        select e.id, e.거래처, e.비목_대분류,
               coalesce((select string_agg(x->>'품목명', ' ')
                           from jsonb_array_elements(coalesce(e.품목,'[]'::jsonb)) x), '') as 품목,
               coalesce(bool_or(d.정정여부), false) as 정정여부
          from app.expenses e
          left join app.decisions d on d.expense_id = e.id
         where e.상태 = '확정' and e.비목_대분류 is not null
         group by e.id, e.거래처, e.비목_대분류, e.품목
        """
    )
    out = []
    for r in rows:
        feat = (r["품목"] or "").strip() or (r["거래처"] or "").strip()
        if len(re.sub(r"\s", "", feat)) < 2:
            continue
        out.append(dict(x=feat[:400], y=r["비목_대분류"],
                        g=(r["거래처"] or f"case{r['id']}"),
                        w=CORRECTION_WEIGHT if r["정정여부"] else 1.0,
                        src="실적-정정" if r["정정여부"] else "실적-동의"))
    return out


def load_씨앗() -> list[dict]:
    """772파일에서 뽑아둔 씨앗. 실적이 쌓이기 전까지 모델을 지탱한다."""
    if not os.path.exists(SEED):
        return []
    out = []
    for line in open(SEED, encoding="utf-8"):
        d = json.loads(line)
        out.append(dict(x=d["x"], y=d["y"], g=d.get("g", "seed"),
                        w=float(d.get("w", 1.0)), src="씨앗"))
    return out


def mk():
    return make_pipeline(
        TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), min_df=1,
                        sublinear_tf=True, max_features=200000),
        LogisticRegression(max_iter=3000, C=4.0, class_weight="balanced"))


def evaluate(data: list[dict]) -> tuple[float, int]:
    """거래처 그룹 분리 정확도. 표본이 모자라면 (nan, 0)."""
    y = np.array([d["y"] for d in data])
    keep = {k for k, n in Counter(y).items() if n >= 5}
    m = np.isin(y, list(keep))
    if m.sum() < 20 or len(keep) < 2:
        return float("nan"), int(m.sum())
    X = [data[i]["x"] for i in np.where(m)[0]]
    g = [data[i]["g"] for i in np.where(m)[0]]
    yy = y[m]
    k = min(5, min(Counter(yy).values()))
    if k < 2:
        return float("nan"), int(m.sum())
    cv = StratifiedGroupKFold(n_splits=k, shuffle=True, random_state=0)
    pred = cross_val_predict(mk(), X, yy, cv=cv, groups=g, n_jobs=1)
    return float((pred == yy).mean()), int(m.sum())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="학습만 하고 배포하지 않는다")
    ap.add_argument("--force", action="store_true", help="실적이 적어도 돌린다")
    args = ap.parse_args()

    실적, 씨앗 = load_실적(), load_씨앗()
    print(f"실적 {len(실적)}건 (정정 {sum(1 for d in 실적 if d['w'] > 1)}건) · 씨앗 {len(씨앗)}건")
    if len(실적) < MIN_NEW and not args.force:
        print(f"확정 실적이 {MIN_NEW}건 미만이라 재학습을 건너뛴다. "
              f"(--force 로 강제)  ← 아직 쌓이는 중이면 정상이다")
        return 0

    data = 씨앗 + 실적
    if not data:
        print("학습할 데이터가 없다"); return 1
    print("  라벨:", dict(Counter(d["y"] for d in data)),
          "\n  출처:", dict(Counter(d["src"] for d in data)))

    새정확도, n_eval = evaluate(data)
    옛정확도 = None
    rows = q("""select 지표 from app.model_versions
                 where 과제='bimok' and 사용중 order by id desc limit 1""")
    if rows and isinstance(rows[0].get("지표"), dict):
        옛정확도 = rows[0]["지표"].get("accuracy_groupsplit")

    print(f"\n거래처 그룹분리 정확도: "
          f"{'측정불가(표본 부족)' if np.isnan(새정확도) else f'{100*새정확도:.1f}% (n={n_eval})'}"
          + (f"   이전 {100*옛정확도:.1f}%" if 옛정확도 else ""))

    # 나빠졌으면 배포하지 않는다. 조용한 후퇴가 제일 위험하다.
    if (옛정확도 and not np.isnan(새정확도) and 새정확도 < 옛정확도 - 0.02):
        print(f"⚠ 이전보다 {100*(옛정확도-새정확도):.1f}p 낮다 — **배포하지 않는다.**")
        print("  데이터가 더 쌓인 뒤 다시 돌리거나, 최근 확정에 잘못된 라벨이 없는지 본다.")
        return 2

    pipe = mk()
    pipe.fit([d["x"] for d in data], [d["y"] for d in data],
             **{f"{pipe.steps[-1][0]}__sample_weight": np.array([d["w"] for d in data])})

    if args.dry_run:
        print("\n--dry-run — 배포하지 않는다")
        return 0

    os.makedirs(MODELS, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    새경로 = os.path.join(MODELS, f"bimok_{stamp}.joblib")
    joblib.dump(pipe, 새경로, compress=3)
    if os.path.exists(ACTIVE):
        shutil.copy2(ACTIVE, os.path.join(MODELS, f"bimok_prev_{stamp}.joblib"))
    shutil.copy2(새경로, ACTIVE)          # 봇은 ACTIVE 경로를 읽는다
    print(f"\n배포: {ACTIVE}  ({os.path.getsize(ACTIVE)/1024:.0f} KB)")

    # 사람에게 보여줄 수치는 **모델 옆에 같이 둔다.** 코드에 박아 두면 재학습 뒤 거짓말이 된다.
    with open(ACTIVE + ".meta.json", "w", encoding="utf-8") as f:
        json.dump(dict(n_train=len(data), n_seed=len(씨앗), n_actual=len(실적),
                       n_correction=sum(1 for d in 실적 if d["w"] > 1),
                       accuracy_groupsplit=None if np.isnan(새정확도) else round(새정확도, 4),
                       n_eval=n_eval, trained_at=stamp), f, ensure_ascii=False, indent=1)

    지표 = dict(accuracy_groupsplit=None if np.isnan(새정확도) else round(새정확도, 4),
              n_eval=n_eval, n_seed=len(씨앗), n_actual=len(실적),
              n_correction=sum(1 for d in 실적 if d["w"] > 1),
              classes=sorted({d["y"] for d in data}),
              correction_weight=CORRECTION_WEIGHT, artifact=새경로)
    with psycopg.connect(DSN, connect_timeout=5) as c, c.cursor() as cur:
        cur.execute("update app.model_versions set 사용중=false where 과제='bimok'")
        cur.execute(
            """insert into app.model_versions
               (과제, 학습건수, 정정건수, 정정가중, 지표, artifact_path, 만든이, 사용중)
               values ('bimok', %s, %s, %s, %s, %s, 'retrain.py', true)""",
            (len(data), 지표["n_correction"], CORRECTION_WEIGHT,
             json.dumps(지표, ensure_ascii=False), ACTIVE))
        c.commit()
    print("app.model_versions 기록 완료 — 봇은 파일 mtime 을 보고 다음 판독부터 새 모델을 쓴다(재시작 불필요)")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())

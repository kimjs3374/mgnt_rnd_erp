"""시연용 합성 증빙을 만든다. **실데이터가 아니다.**

구조(항목명·자릿수·배치)만 실제 세금계산서를 본뜨고 값은 전부 생성한다.
거래처명은 가공이고, 자사 사업자번호만 진짜를 쓴다 — 거래 방향 확정이 그 번호로 돌기 때문이다.
"""

import os
import pathlib
import re
import subprocess
import sys

OUR = re.sub(r"\D", "", os.environ["OUR_BRN"])
OUT = pathlib.Path("/rnd/data/samples")
OUT.mkdir(parents=True, exist_ok=True)


def brn_fmt(b: str) -> str:
    return f"{b[:3]}-{b[3:5]}-{b[5:]}" if len(b) == 10 else b


HTML = """<!doctype html><meta charset="utf-8">
<style>
  @page {{ size: A4 landscape; margin: 14mm; }}
  body {{ font-family: "Noto Sans CJK KR","Malgun Gothic",sans-serif; font-size: 11px; color:#111; }}
  h1 {{ text-align:center; font-size:20px; letter-spacing:.5em; margin:0 0 10px; }}
  table {{ border-collapse: collapse; width:100%; }}
  td,th {{ border:1px solid #333; padding:4px 6px; }}
  .lbl {{ background:#f2f4f8; text-align:center; width:70px; }}
  .r {{ text-align:right; }} .c {{ text-align:center; }}
  .small {{ font-size:9px; color:#666; margin-top:8px; }}
</style>
<h1>전자세금계산서</h1>
<table>
  <tr>
    <td class="lbl" rowspan="4">공<br>급<br>자</td>
    <td class="lbl">등록번호</td><td>{sup_brn}</td>
    <td class="lbl" rowspan="4">공급<br>받는<br>자</td>
    <td class="lbl">등록번호</td><td>{buy_brn}</td>
  </tr>
  <tr><td class="lbl">상호</td><td>{sup_name}</td><td class="lbl">상호</td><td>{buy_name}</td></tr>
  <tr><td class="lbl">사업장</td><td>경기도 화성시 동탄대로 000</td><td class="lbl">사업장</td><td>전남 장성군 남면 000</td></tr>
  <tr><td class="lbl">업태/종목</td><td>제조/화학소재</td><td class="lbl">업태/종목</td><td>제조/이차전지</td></tr>
</table>
<table style="margin-top:6px">
  <tr><th class="lbl">작성일자</th><td class="c">{date}</td>
      <th class="lbl">공급가액</th><td class="r">{supply}</td>
      <th class="lbl">세액</th><td class="r">{vat}</td>
      <th class="lbl">합계금액</th><td class="r"><b>{total}</b></td></tr>
</table>
<table style="margin-top:6px">
  <tr><th class="c">월일</th><th class="c">품목</th><th class="c">규격</th>
      <th class="c">수량</th><th class="c">단가</th><th class="c">공급가액</th><th class="c">세액</th></tr>
  {rows}
</table>
<div class="small">이 문서는 시연용으로 생성한 합성 자료입니다. 실제 거래가 아닙니다.</div>
"""

ROW = (
    '<tr><td class="c">{md}</td><td>{name}</td><td class="c">{spec}</td>'
    '<td class="c">{qty}</td><td class="r">{unit}</td><td class="r">{amt}</td><td class="r">{vat}</td></tr>'
)


def build(fname, sup_name, sup_brn, date, items, *, buyer_is_us=True):
    supply = sum(i["amt"] for i in items)
    vat = round(supply * 0.1)
    rows = "".join(
        ROW.format(
            md=date[5:].replace("-", "/"),
            name=i["name"],
            spec=i.get("spec", ""),
            qty=i.get("qty", 1),
            unit=f'{i["amt"] // max(i.get("qty", 1), 1):,}',
            amt=f'{i["amt"]:,}',
            vat=f'{round(i["amt"] * 0.1):,}',
        )
        for i in items
    )
    html = HTML.format(
        sup_brn=brn_fmt(sup_brn),
        sup_name=sup_name,
        buy_brn=brn_fmt(OUR if buyer_is_us else sup_brn),
        buy_name="(주)매그나텍" if buyer_is_us else "○○상사",
        date=date,
        supply=f"{supply:,}",
        vat=f"{vat:,}",
        total=f"{supply + vat:,}",
        rows=rows,
    )
    h = OUT / f"{fname}.html"
    h.write_text(html, encoding="utf-8")
    pdf = OUT / f"{fname}.pdf"
    subprocess.run(
        [
            "google-chrome", "--headless=new", "--disable-gpu", "--no-sandbox",
            f"--print-to-pdf={pdf}", "--no-pdf-header-footer",
            f"--user-data-dir=/tmp/chrome-pdf-{fname}", f"file://{h}",
        ],
        check=True, capture_output=True,
    )
    h.unlink()
    print(f"  {pdf}  {pdf.stat().st_size:,}바이트")
    return pdf


if __name__ == "__main__":
    build(
        "01_음극소재",
        "(주)에이치소재", "2208612345",
        "2024-11-20",
        [{"name": "음극소재 (인조흑연)", "spec": "20kg", "qty": 20, "amt": 9_240_000}],
    )
    build(
        "02_노트북",
        "컴퓨존", "1078212345",
        "2024-06-11",
        [{"name": "노트북 (연구원 지급용)", "spec": "16GB/512GB", "qty": 1, "amt": 1_740_000}],
    )
    build(
        "03_노트북_다른판매처",
        "(주)디지털월드", "3148612345",
        "2024-07-02",
        [{"name": "노트북 1대", "spec": "32GB/1TB", "qty": 1, "amt": 1_563_636}],
    )

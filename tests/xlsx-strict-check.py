"""엑셀이 「복구」를 띄우는 흔한 원인만 골라 검사한다. openpyxl 이 없어도 여기까지는 볼 수 있다."""
import zipfile, xml.etree.ElementTree as ET, re, sys

z = zipfile.ZipFile('/tmp/p.xlsx')
ok = True

# ① 모든 XML 이 well-formed 인가
for n in z.namelist():
    if n.endswith('.xml') or n.endswith('.rels'):
        try:
            ET.fromstring(z.read(n))
        except Exception as e:
            ok = False
            print("  ✗ XML 깨짐", n, e)
print("  ok XML well-formed" if ok else "")

# ② 관계(rels) 대상이 실제로 들어 있는가
for rel in ['_rels/.rels', 'xl/_rels/workbook.xml.rels']:
    root = ET.fromstring(z.read(rel))
    base = '' if rel == '_rels/.rels' else 'xl/'
    for r in root:
        t = r.get('Target')
        path = (base + t).replace('//', '/')
        if path not in z.namelist():
            ok = False
            print("  ✗ 관계 대상 없음", rel, t)
print("  ok 관계 대상 모두 존재" if ok else "")

s = z.read('xl/worksheets/sheet1.xml').decode()

# ③ mergeCells 가 sheetData 뒤에 오는가 (앞에 오면 엑셀이 거부한다)
if s.index('<sheetData>') > s.index('<mergeCells'):
    ok = False
    print("  ✗ mergeCells 가 sheetData 앞에 있다")
else:
    print("  ok mergeCells 위치")

# ④ 스타일 인덱스가 cellXfs 범위 안인가
xfs = len(re.findall(r'<xf ', z.read('xl/styles.xml').decode().split('<cellXfs')[1]))
used = {int(m) for m in re.findall(r'<c [^>]*s="(\d+)"', s)}
print(f"  {'ok' if max(used, default=0) < xfs else '✗'} 스타일 인덱스 {sorted(used)} < cellXfs {xfs}")
if max(used, default=0) >= xfs:
    ok = False

# ⑤ 행 번호가 오름차순·중복 없는가
rows = [int(m) for m in re.findall(r'<row r="(\d+)"', s)]
print(f"  {'ok' if rows == sorted(set(rows)) else '✗'} 행 번호 {len(rows)}개 오름차순·중복없음")
if rows != sorted(set(rows)):
    ok = False

# ⑥ 병합 왼쪽 위 칸에 값이 있는가 (없으면 엑셀에서 빈칸으로 보인다)
merges = re.findall(r'<mergeCell ref="([A-Z]+\d+):[A-Z]+\d+"/>', s)
없는것 = [m for m in merges if f'r="{m}"' not in s]
print(f"  {'ok' if not 없는것 else '△'} 병합 {len(merges)}개 · 값 없는 시작칸 {없는것[:4]}")

# ⑦ inlineStr 셀에 <v> 를 쓰지 않았는가
if re.search(r't="inlineStr"[^>]*><v>', s):
    ok = False
    print("  ✗ inlineStr 에 <v> 를 썼다")
else:
    print("  ok inlineStr 형식")

print("판정:", "통과" if ok else "실패")
sys.exit(0 if ok else 1)

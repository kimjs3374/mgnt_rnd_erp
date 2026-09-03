/**
 * ZIP 만들기 — 압축하지 않는 store 방식. **의존성을 하나도 안 늘린다.**
 *
 * 왜 직접 쓰나: 증빙은 이미 pdf·jpg 라 압축이 거의 안 먹는다(수%). 그 몇 %를 위해
 * 패키지를 하나 더 들이면 스택 고정 원칙(CLAUDE.md §7)이 흔들리고, 대회 마지막 날에
 * `npm install` 은 서버 재시작을 부른다([[solverthon-dev-server-mode]]).
 * store 방식은 명세가 단순하고 모든 zip 도구가 읽는다.
 *
 * ⚠ 한글 파일명 — UTF-8 플래그(bit 11)를 세운다. 이걸 빼면 윈도우 알집에서 이름이 깨진다.
 *   ZIP64 는 쓰지 않는다(파일 25MB 제한 · 총 4GB 미만).
 */

/** CRC-32 (IEEE 802.3). zip 이 파일마다 요구한다. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** DOS 시각(2초 단위). 값이 이상해도 zip 이 열리긴 하지만 목록 날짜가 1980 으로 보인다. */
function dosDateTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f)
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

export type ZipEntry = { name: string; data: Uint8Array; date?: Date }

/**
 * 같은 이름이 여러 개면 zip 안에서 하나만 보인다.
 * 실제로 자주 생긴다 — 견적서를 두 번 올리거나 거래처마다 「지출결의서.pdf」로 저장한다.
 * 그래서 `이름 (2).pdf` 로 벌린다.
 */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((raw) => {
    const n = raw.replace(/[\\/:*?"<>|]/g, "_") || "파일"
    const count = seen.get(n) ?? 0
    seen.set(n, count + 1)
    if (count === 0) return n
    const dot = n.lastIndexOf(".")
    return dot > 0 ? `${n.slice(0, dot)} (${count + 1})${n.slice(dot)}` : `${n} (${count + 1})`
  })
}

export function makeZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const e of entries) {
    const nameBytes = enc.encode(e.name)
    const crc = crc32(e.data)
    const { time, date } = dosDateTime(e.date ?? new Date())

    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true) // local file header
    lv.setUint16(4, 20, true) // version needed
    lv.setUint16(6, 0x0800, true) // bit 11 = 이름이 UTF-8 이다
    lv.setUint16(8, 0, true) // method 0 = store
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, e.data.length, true)
    lv.setUint32(22, e.data.length, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true) // extra field 없음
    local.set(nameBytes, 30)

    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true) // central directory header
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true) // version needed
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, e.data.length, true)
    cv.setUint32(24, e.data.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, offset, true) // 이 파일의 local header 위치
    central.set(nameBytes, 46)

    locals.push(local, e.data)
    centrals.push(central)
    offset += local.length + e.data.length
  }

  const centralSize = centrals.reduce((s, c) => s + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true) // end of central directory
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const total = offset + centralSize + end.length
  const out = new Uint8Array(total)
  let p = 0
  for (const b of [...locals, ...centrals, end]) {
    out.set(b, p)
    p += b.length
  }
  return out
}

import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // ⚠ 네 명이 같은 디렉터리에서 각자 next dev 를 돌린다.
  //    .next 를 공유하면 서로의 빌드를 밀어내고
  //    「Another next build process is already running」 으로 막힌다.
  //    각자 NEXT_DIST_DIR=.next-<이름> 을 주면 충돌이 사라진다.
  //    배포(rnd-web.service)는 기본값 .next 를 그대로 쓴다.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",

  // ⚠ dev 모드를 nginx 뒤(rnd.mgnt.kr)에서 서빙할 때 반드시 필요하다.
  //    Next 는 dev 리소스(HMR 웹소켓·청크)를 기본적으로 cross-origin 차단하는데,
  //    우리는 Cloudflare → VPS → nginx 를 거쳐 오므로 origin 이 localhost 가 아니다.
  //    이게 없으면 화면은 뜨는데 저장해도 자동 반영이 안 된다. 로그에만 조용히 찍힌다.
  //    프로덕션 빌드에는 영향이 없다.
  allowedDevOrigins: ["rnd.mgnt.kr", "100.110.60.7"],

  experimental: {
    // ⚠ 서버 액션에는 Origin 검증이 걸려 있다.
    //    우리 경로는 Cloudflare → VPS → tailnet → nginx 로 프록시가 여러 겹이라
    //    이걸 안 넣으면 폼이 **조용히 거부된다.** 에러도 안 난다.
    //    배포 직후 로그인이 안 되면 여기부터 본다.
    serverActions: {
      allowedOrigins: ["rnd.mgnt.kr", "100.110.60.7:3610", "localhost:3610"],

      // ⚠ 서버 액션 본문 기본 상한이 **1MB** 다. 파일 업로드가 서버 액션으로 오므로
      //    이걸 안 올리면 1MB 넘는 증빙·서류가 조용히 막힌다 —
      //    액션 코드에 닿기 전에 거부되므로 우리 에러 메시지도 안 뜬다.
      //    업로드 쪽 상한이 25MB 라 그보다 넉넉히 잡는다(멀티파트 오버헤드 포함).
      //    app/actions/evidence-files.ts · app/actions/documents.ts
      bodySizeLimit: "30mb",
    },
  },
}

export default nextConfig

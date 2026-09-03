import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // ⚠ 네 명이 같은 디렉터리에서 각자 next dev 를 돌린다.
  //    .next 를 공유하면 서로의 빌드를 밀어내고
  //    「Another next build process is already running」 으로 막힌다.
  //    각자 NEXT_DIST_DIR=.next-<이름> 을 주면 충돌이 사라진다.
  //    배포(rnd-web.service)는 기본값 .next 를 그대로 쓴다.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",

  experimental: {
    // ⚠ 서버 액션에는 Origin 검증이 걸려 있다.
    //    우리 경로는 Cloudflare → VPS → tailnet → nginx 로 프록시가 여러 겹이라
    //    이걸 안 넣으면 폼이 **조용히 거부된다.** 에러도 안 난다.
    //    배포 직후 로그인이 안 되면 여기부터 본다.
    serverActions: {
      allowedOrigins: ["rnd.mgnt.kr", "100.110.60.7:3610", "localhost:3610"],
    },
  },
}

export default nextConfig

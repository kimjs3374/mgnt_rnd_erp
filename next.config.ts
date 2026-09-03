import type { NextConfig } from "next"

const nextConfig: NextConfig = {
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

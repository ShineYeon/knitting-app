import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 모바일 기기(아이폰/아이패드) 접속 시 HMR 무한 새로고침 차단 해제
  allowedDevOrigins: [
    "192.168.0.50",
    "192.168.0.50:3000",
    "localhost:3000",
    "127.0.0.1:3000",
  ],
};

export default nextConfig;
'use client';

import dynamic from 'next/dynamic';

// 클라이언트 컴포넌트 환경에서 SSR을 끄고 브라우저에서만 로드하도록 설정
const CounterApp = dynamic(() => import('./CounterApp'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center text-stone-500 font-medium">
      앱을 불러오는 중...
    </div>
  ),
});

export default function Page() {
  return <CounterApp />;
}
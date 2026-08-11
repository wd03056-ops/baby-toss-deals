"use client";

import nextDynamic from "next/dynamic";

const HomeClient = nextDynamic(() => import("./home-client"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-dvh items-center justify-center bg-[#FDFBF7] text-sm font-medium text-[#7A726A]">
      불러오는 중…
    </div>
  ),
});

export default function HomeWrapper() {
  return <HomeClient />;
}

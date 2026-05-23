import { Suspense } from "react";
import TalkClient from "./TalkClient";

export default function TalkPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen text-gray-400">
          로딩 중...
        </div>
      }
    >
      <TalkClient />
    </Suspense>
  );
}

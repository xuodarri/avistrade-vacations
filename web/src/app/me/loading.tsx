import { Card, Skeleton } from "@/components/kit";

/** Скелетон «Моего отпуска», пока сервер собирает план и загрузку группы. */
export default function Loading() {
  return (
    <div aria-busy>
      <div className="flex flex-col gap-2 mb-7"><Skeleton w={280} h={34} /><Skeleton w={360} h={16} /></div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
        <Card className="flex flex-col gap-4">
          <Skeleton w="40%" h={22} />
          <div className="grid grid-cols-[repeat(auto-fill,280px)] justify-between gap-y-5">
            {[0, 1, 2].map((k) => (
              <div key={k} className="grid grid-cols-7 gap-1">
                {Array.from({ length: 35 }, (_, i) => <Skeleton key={i} h={36} round />)}
              </div>
            ))}
          </div>
        </Card>
        <Card className="flex flex-col gap-4"><Skeleton w="50%" h={22} /><Skeleton h={84} /><Skeleton /><Skeleton w="70%" /><Skeleton h={44} /></Card>
      </div>
    </div>
  );
}

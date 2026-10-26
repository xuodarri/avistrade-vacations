"use client";

/** Демо движка тура: элементы с якорями demo.*, крайний справа, высокий блок, капсула и шторка. */
import { useState } from "react";
import { PanelRight, Play } from "lucide-react";
import { Button, Card, PageHeader, Pill, Sheet, Surface } from "@/components/kit";
import { TourRunner, tourFor } from "@/components/tour";

const demo = tourFor("/tour-demo")!;

export default function TourDemoPage() {
  const [run, setRun] = useState(0);
  const [sheet, setSheet] = useState(false);
  return (
    <>
      <div data-tour="demo.title">
        <PageHeader title="Демо тура" subtitle="Проверка движка «Помощи» до того, как на экранах появятся якоря."
          actions={<Button variant="primary" icon={Play} onClick={() => setRun((n) => n + 1)}>Запустить тур</Button>} />
      </div>
      <div className="flex justify-end mb-6">
        <Surface level="block" tone="raised" pad={16} data-tour="demo.right" className="w-[220px]">Справа у края</Surface>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-6 items-start">
        <Card data-tour="demo.tall" className="h-[1400px] flex items-end">
          <p className="text-muted px-1">Высокий блок: тур прокручивает к его началу.</p>
        </Card>
        <Card className="flex flex-col gap-3 items-start">
          <span data-tour="demo.pill" className="inline-flex rounded-full"><Pill tone="vacation" dot>Ваш отпуск</Pill></span>
          <Button icon={PanelRight} data-tour="demo.open" onClick={() => setSheet(true)}>Открыть шторку</Button>
        </Card>
      </div>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Шторка" description="Её открыл сам тур">
        <Surface nested tone="flat" data-tour="demo.sheet">Цель шага внутри шторки.</Surface>
      </Sheet>
      {run > 0 && <TourRunner key={run} tour={demo} onClose={() => setRun(0)} />}
    </>
  );
}

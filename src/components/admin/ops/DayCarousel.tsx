import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";
import {
  addDays,
  isoOf,
  startOfLocalDay,
  weekdayMonIndex,
  WEEKDAY_SHORT_MON,
} from "@/lib/admin-dates";

type Props = {
  selectedIso: string;
  todayIso: string;
  counts: Map<string, number>;
  onSelect: (iso: string) => void;
  span?: number;
};

export function DayCarousel({ selectedIso, todayIso, counts, onSelect, span = 15 }: Props) {
  const [api, setApi] = useState<CarouselApi>();
  const todayIndex = Math.floor(span / 2);

  const days = useMemo(() => {
    const today = startOfLocalDay(new Date(`${todayIso}T00:00:00`));
    return Array.from({ length: span }, (_, i) => addDays(today, i - todayIndex));
  }, [span, todayIndex, todayIso]);

  useEffect(() => {
    if (!api) return;
    const idx = days.findIndex((d) => isoOf(d) === selectedIso);
    if (idx >= 0) api.scrollTo(idx, true);
  }, [api, days, selectedIso]);

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0"
        onClick={() => api?.scrollPrev()}
        aria-label="Días anteriores"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Carousel
        className="min-w-0 flex-1"
        opts={{ align: "center", containScroll: false, startIndex: todayIndex }}
        setApi={setApi}
      >
        <CarouselContent className="-ml-2">
          {days.map((d) => {
            const iso = isoOf(d);
            const isToday = iso === todayIso;
            const isSelected = iso === selectedIso;
            const count = counts.get(iso) ?? 0;
            return (
              <CarouselItem key={iso} className="basis-[4.75rem] pl-2 sm:basis-20">
                <button
                  type="button"
                  onClick={() => onSelect(iso)}
                  className={cn(
                    "flex w-full flex-col items-center rounded-xl border px-1.5 py-2 text-center transition-colors",
                    isSelected && "border-primary bg-primary text-primary-foreground",
                    !isSelected && isToday && "border-primary ring-2 ring-primary/40",
                    !isSelected && !isToday && "hover:bg-muted/60",
                  )}
                >
                  <span
                    className={cn(
                      "text-[10px] uppercase tracking-wide",
                      isSelected ? "text-primary-foreground/80" : "text-muted-foreground",
                    )}
                  >
                    {WEEKDAY_SHORT_MON[weekdayMonIndex(d)]}
                  </span>
                  <span className="text-lg font-semibold leading-tight">{d.getDate()}</span>
                  <span
                    className={cn(
                      "text-[10px] tabular-nums",
                      isSelected ? "text-primary-foreground/80" : "text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                </button>
              </CarouselItem>
            );
          })}
        </CarouselContent>
      </Carousel>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0"
        onClick={() => api?.scrollNext()}
        aria-label="Días siguientes"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

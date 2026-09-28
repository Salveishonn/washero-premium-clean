import { useState } from "react";

import { OperatorAssignmentFields } from "@/components/admin/OperatorAssignmentFields";
import type { Booking } from "@/components/admin/bookings";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

export function HubOperatorAssignButton({ booking }: { booking: Booking }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const fields = (
    <OperatorAssignmentFields booking={booking} variant="compact" onSaved={() => setOpen(false)} />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button type="button" size="sm" variant="outline" aria-label="Asignar operador">
            Asignar
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="space-y-3">
          <SheetHeader>
            <SheetTitle>Asignar operador</SheetTitle>
          </SheetHeader>
          {fields}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" aria-label="Asignar operador">
          Asignar
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="z-50 w-80 bg-popover p-3 shadow-lg" onClick={(e) => e.stopPropagation()}>
        {fields}
      </PopoverContent>
    </Popover>
  );
}

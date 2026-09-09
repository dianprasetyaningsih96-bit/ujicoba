import * as React from "react";
import { useState, useMemo, useEffect } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface DatePickerInputProps {
  value?: string; // "YYYY-MM-DD"
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
}

export function DatePickerInput({
  value,
  onChange,
  placeholder = "DD/MM/YYYY",
  className,
}: DatePickerInputProps) {
  const [open, setOpen] = useState(false);

  // parse "YYYY-MM-DD" to Date
  const dateObj = useMemo(() => {
    if (!value) return undefined;
    const parts = value.split("-").map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return undefined;
    const [y, m, d] = parts;
    return new Date(y, m - 1, d);
  }, [value]);

  const [text, setText] = useState(() => {
    if (!dateObj || isNaN(dateObj.getTime())) return "";
    const day = String(dateObj.getDate()).padStart(2, "0");
    const month = String(dateObj.getMonth() + 1).padStart(2, "0");
    const year = dateObj.getFullYear();
    return `${day}/${month}/${year}`;
  });

  useEffect(() => {
    if (!dateObj || isNaN(dateObj.getTime())) {
      setText("");
    } else {
      const day = String(dateObj.getDate()).padStart(2, "0");
      const month = String(dateObj.getMonth() + 1).padStart(2, "0");
      const year = dateObj.getFullYear();
      setText(`${day}/${month}/${year}`);
    }
  }, [value, dateObj]);

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/[^\d\/]/g, "");

    setText(val);

    // If matches DD/MM/YYYY
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(val)) {
      const [d, m, y] = val.split("/").map(Number);
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900 && y <= 2100) {
        const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        onChange(iso);
      }
    } else if (val === "") {
      onChange("");
    }
  };

  return (
    <div className={cn("relative flex items-center", className)}>
      <Input
        type="text"
        placeholder={placeholder}
        value={text}
        onChange={handleTextChange}
        maxLength={10}
        className="pr-8 font-mono text-xs h-9 bg-background"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 h-9 w-8 text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <CalendarIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 z-50 shadow-lg border" align="start">
          <Calendar
            mode="single"
            selected={dateObj}
            onSelect={(d) => {
              if (d) {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, "0");
                const day = String(d.getDate()).padStart(2, "0");
                onChange(`${y}-${m}-${day}`);
              } else {
                onChange("");
              }
              setOpen(false);
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

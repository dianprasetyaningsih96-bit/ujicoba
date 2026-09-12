import { useMemo } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface DataTablePaginationProps {
  currentPage: number;
  pageSize: number;
  totalRecords: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  entityLabel?: string;
  className?: string;
}

export function DataTablePagination({
  currentPage,
  pageSize,
  totalRecords,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  entityLabel = "data",
  className,
}: DataTablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const startIndex = totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endIndex = Math.min(currentPage * pageSize, totalRecords);

  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages: (number | "ellipsis-start" | "ellipsis-end")[] = [];
    if (currentPage <= 4) {
      for (let i = 1; i <= 5; i++) pages.push(i);
      pages.push("ellipsis-end");
      pages.push(totalPages);
    } else if (currentPage >= totalPages - 3) {
      pages.push(1);
      pages.push("ellipsis-start");
      for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      pages.push("ellipsis-start");
      pages.push(currentPage - 1);
      pages.push(currentPage);
      pages.push(currentPage + 1);
      pages.push("ellipsis-end");
      pages.push(totalPages);
    }
    return pages;
  }, [currentPage, totalPages]);

  if (totalRecords === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t bg-card text-xs",
        className
      )}
    >
      <div className="flex items-center gap-3 text-muted-foreground">
        <span>
          Menampilkan <span className="font-semibold text-foreground">{startIndex}–{endIndex}</span> dari{" "}
          <span className="font-semibold text-foreground">{totalRecords}</span> {entityLabel}
        </span>
        {onPageSizeChange && (
          <div className="hidden sm:flex items-center gap-1.5 ml-2 border-l pl-3">
            <span>Per halaman:</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => onPageSizeChange(Number(v))}
            >
              <SelectTrigger className="h-7 w-[70px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((opt) => (
                  <SelectItem key={opt} value={String(opt)}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          {/* Ke Halaman Pertama */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(1)}
            title="Halaman Pertama"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>

          {/* Halaman Sebelumnya */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2.5 gap-1"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            title="Halaman Sebelumnya"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Prev</span>
          </Button>

          {/* Tombol Nomor Halaman Dinamis */}
          <div className="flex items-center gap-1">
            {pageNumbers.map((p, idx) => {
              if (p === "ellipsis-start" || p === "ellipsis-end") {
                return (
                  <span
                    key={`ellipsis-${idx}`}
                    className="w-8 h-8 flex items-center justify-center text-muted-foreground select-none font-semibold"
                  >
                    …
                  </span>
                );
              }
              const isCurrent = p === currentPage;
              return (
                <Button
                  key={p}
                  variant={isCurrent ? "default" : "outline"}
                  size="sm"
                  className={cn(
                    "h-8 w-8 p-0 font-medium",
                    isCurrent ? "pointer-events-none shadow-sm" : ""
                  )}
                  onClick={() => onPageChange(p as number)}
                >
                  {p}
                </Button>
              );
            })}
          </div>

          {/* Halaman Selanjutnya */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2.5 gap-1"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            title="Halaman Selanjutnya"
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight className="h-4 w-4" />
          </Button>

          {/* Ke Halaman Terakhir */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(totalPages)}
            title="Halaman Terakhir"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

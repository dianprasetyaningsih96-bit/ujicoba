import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { ReactNode } from "react";

interface Props {
  title: string;
  description?: string;
  onAdd?: () => void;
  addLabel?: string;
  canWrite?: boolean;
  extra?: ReactNode;
  action?: ReactNode;
}

export function MasterPageHeader({
  title,
  description,
  onAdd,
  addLabel = "Tambah",
  canWrite = true,
  extra,
  action,
}: Props) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {extra}
        {action}
        {canWrite && onAdd && (
          <Button onClick={onAdd} className="gap-2 shrink-0">
            <Plus className="h-4 w-4" />
            {addLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
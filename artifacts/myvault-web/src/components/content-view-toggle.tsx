import { Folder, Grid2X2, List } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type ContentViewMode = "grid" | "list" | "icon";

interface ContentViewToggleProps {
  value: ContentViewMode;
  onChange: (value: ContentViewMode) => void;
}

const viewOptions = [
  { value: "grid", label: "Grid view", icon: Grid2X2 },
  { value: "list", label: "List view", icon: List },
  { value: "icon", label: "Icon view", icon: Folder },
] as const;

export function ContentViewToggle({ value, onChange }: ContentViewToggleProps) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue) onChange(nextValue as ContentViewMode);
      }}
      variant="outline"
      size="sm"
      aria-label="Content view"
      className="gap-0 rounded-lg bg-card p-1 shadow-[0_1px_3px_rgba(15,23,42,0.08)]"
    >
      {viewOptions.map(({ value: optionValue, label, icon: Icon }) => (
        <Tooltip key={optionValue}>
          <TooltipTrigger asChild>
            <ToggleGroupItem
              value={optionValue}
              aria-label={label}
              data-testid={`view-${optionValue}`}
              className="h-8 w-8 rounded-md border-0 p-0 text-muted-foreground hover:text-foreground data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
            >
              <Icon className="h-4 w-4" />
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { PartySummary } from "@/lib/api";
import type { MoveTarget } from "@/lib/partyMoveHelpers";

type Props = {
  /** DB-tracked parties (custom-created or previously touched via reassignment). */
  parties: PartySummary[];
  /** Auto-detected group names currently visible in the summary table that don't have a
   * DB row yet -- still selectable, just not renameable/deletable until touched. */
  extraNames?: string[];
  onSelect: (target: MoveTarget) => void;
  trigger: React.ReactNode;
};

/** Searchable "move to party" combobox shared by the per-row action, the in-table bulk bar,
 * and the Manage Parties panel's selection section -- one picker, three call sites. */
export function PartyPicker({ parties, extraNames = [], onSelect, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const options = useMemo(() => {
    const seen = new Map<string, { id: string | null; name: string }>();
    for (const p of parties) seen.set(p.name.toLowerCase(), { id: p.id, name: p.name });
    for (const name of extraNames) {
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, { id: null, name });
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [parties, extraNames]);

  const trimmedQuery = query.trim();
  const hasExactMatch = options.some((o) => o.name.toLowerCase() === trimmedQuery.toLowerCase());

  const handleSelect = (target: MoveTarget) => {
    onSelect(target);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start" onClick={(e) => e.stopPropagation()}>
        <Command>
          <CommandInput placeholder="Search parties..." value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty className="py-3 text-xs">No matching party.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.name}
                  value={option.name}
                  onSelect={() => handleSelect({ id: option.id, name: option.name } as MoveTarget)}
                  className="text-xs"
                >
                  {option.name}
                </CommandItem>
              ))}
            </CommandGroup>
            {trimmedQuery && !hasExactMatch && (
              <CommandGroup>
                <CommandItem
                  value={`__create__${trimmedQuery}`}
                  onSelect={() => handleSelect({ id: null, name: trimmedQuery })}
                  className="text-xs"
                >
                  <Plus className="h-3 w-3" />
                  Create &quot;{trimmedQuery}&quot;
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

import {
  Select as AriaSelect,
  SelectValue,
  Button,
  Popover,
  ListBox,
  ListBoxItem,
  type SelectProps as AriaSelectProps,
} from "react-aria-components";
import { cn } from "../lib/utils";

export interface SelectItem {
  id: string;
  label: string;
}

export interface SelectProps<T extends SelectItem> extends Omit<AriaSelectProps<T>, "children"> {
  items: T[];
  placeholder: string;
  className?: string;
}

export function Select<T extends SelectItem>({
  items,
  placeholder,
  className,
  ...props
}: SelectProps<T>) {
  return (
    <AriaSelect className={cn("flex flex-col gap-1", className)} {...props}>
      <Button className="flex h-10 w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
        <SelectValue<T> className="text-gray-900 data-[placeholder]:text-gray-400">
          {({ selectedItem }) => (selectedItem ? selectedItem.label : placeholder)}
        </SelectValue>
        <span aria-hidden="true" className="text-gray-400">
          ▼
        </span>
      </Button>
      <Popover className="w-[--trigger-width] rounded-md border border-gray-200 bg-white shadow-md outline-none">
        <ListBox<T> className="max-h-60 overflow-auto p-1" items={items}>
          {(item) => (
            <ListBoxItem
              id={item.id}
              textValue={item.label}
              className="cursor-pointer rounded px-2 py-1.5 text-sm outline-none hover:bg-blue-50 focus:bg-blue-100 selected:bg-blue-600 selected:text-white"
            >
              {item.label}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}

import type { ReactNode, Key } from "react";
import { MenuTrigger, Menu, MenuItem, Popover, type MenuProps } from "react-aria-components";
import { cn } from "../lib/utils";

export interface DropdownMenuItem {
  id: string;
  label: string;
  onAction?: () => void;
}

export interface DropdownMenuProps extends Omit<MenuProps<DropdownMenuItem>, "children" | "items"> {
  trigger: ReactNode;
  items: DropdownMenuItem[];
  className?: string;
}

export function DropdownMenu({ trigger, items, className, ...props }: Readonly<DropdownMenuProps>) {
  function handleAction(key: Key) {
    const item = items.find((i) => i.id === key);
    item?.onAction?.();
  }

  return (
    <MenuTrigger>
      {trigger}
      <Popover className="z-50 min-w-[8rem] overflow-auto rounded-md border border-gray-200 bg-white p-1 shadow-md outline-none">
        <Menu<DropdownMenuItem>
          className={cn("outline-none", className)}
          items={items}
          onAction={handleAction}
          {...props}
        >
          {(item) => (
            <MenuItem
              id={item.id}
              textValue={item.label}
              className="cursor-pointer rounded px-2 py-1.5 text-sm outline-none hover:bg-blue-50 focus:bg-blue-100"
            >
              {item.label}
            </MenuItem>
          )}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

import type { ReactNode } from "react";
import {
  Tabs as AriaTabs,
  TabList,
  Tab,
  TabPanel,
  type TabsProps as AriaTabsProps,
  type TabRenderProps,
} from "react-aria-components";
import { cn } from "../lib/utils";

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

export interface TabsProps extends Omit<AriaTabsProps, "children"> {
  tabs: TabItem[];
  className?: string;
}

export function Tabs({ tabs, className, ...props }: TabsProps) {
  return (
    <AriaTabs className={cn("flex flex-col gap-4", className)} {...props}>
      <TabList className="flex border-b border-gray-200">
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            id={tab.id}
            className={({ isSelected }: TabRenderProps) =>
              cn(
                "cursor-pointer border-b-2 px-4 py-2 text-sm font-medium outline-none transition-colors",
                isSelected
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
              )
            }
          >
            {tab.label}
          </Tab>
        ))}
      </TabList>
      {tabs.map((tab) => (
        <TabPanel key={tab.id} id={tab.id} className="outline-none">
          {tab.content}
        </TabPanel>
      ))}
    </AriaTabs>
  );
}

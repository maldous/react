import { Badge, type BadgeProps } from "@platform/ui-design-system";

// Level is a log data value (info/error/…), not UI copy, so it renders verbatim.
const LEVEL_VARIANT: Record<string, BadgeProps["variant"]> = {
  trace: "secondary",
  debug: "secondary",
  info: "default",
  warn: "outline",
  error: "destructive",
  fatal: "destructive",
};

export function LogLevelBadge({ level }: Readonly<{ level?: string }>) {
  if (!level) return null;
  return (
    <Badge variant={LEVEL_VARIANT[level] ?? "secondary"} data-testid="log-level-badge">
      {level}
    </Badge>
  );
}

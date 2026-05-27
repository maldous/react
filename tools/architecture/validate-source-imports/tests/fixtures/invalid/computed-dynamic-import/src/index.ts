import { Domain } from "@platform/domain-core";

const locale = "en";
const localeModule = await import(`./locales/${locale}`);

export const packageName = "@platform/feature-workflow";

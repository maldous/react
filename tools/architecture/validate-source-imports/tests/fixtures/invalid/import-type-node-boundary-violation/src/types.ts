// ImportTypeNode form: type X = import("specifier").Type
// Domain packages must not import react even via import-type syntax
type MyFC = import("react").FC<{}>;
export type { MyFC };

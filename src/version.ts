import pkg from "../package.json" with { type: "json" };

export const VERSION: string = pkg.version;

/** Whether `version` ("0.15.0") is a later release than `than`, comparing each number in turn. */
export function isNewer(version: string, than: string = VERSION): boolean {
  const a = version.split(".").map(Number);
  const b = than.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

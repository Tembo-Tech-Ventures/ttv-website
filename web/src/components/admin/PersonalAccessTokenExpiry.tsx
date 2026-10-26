/** @jsxImportSource react */
/** @jsxRuntime automatic */
import { PERSONAL_ACCESS_TOKEN_EXPIRY_OPTIONS } from "@/lib/personal-access-tokens";

/** Server-rendered native control; no client hydration is needed. */
export function PersonalAccessTokenExpiry() {
  return (
    <label className="flex flex-col gap-1.5 text-sm text-white/80">
      Expires
      <select name="duration" className="form-control" defaultValue={24}>
        {PERSONAL_ACCESS_TOKEN_EXPIRY_OPTIONS.map(({ hours, label }) => (
          <option key={hours} value={hours}>{label}</option>
        ))}
      </select>
    </label>
  );
}

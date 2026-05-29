import type {
  GetOrganisationProfileResponse,
  UpdateOrganisationProfileRequest,
  UpdateOrganisationProfileResponse,
} from "@platform/contracts-organisation";

export async function fetchOrganisationProfile(): Promise<GetOrganisationProfileResponse> {
  const res = await fetch("/api/organisation/profile", { credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ code: "UNKNOWN" }));
    const e = Object.assign(
      new Error(
        (err as { message?: string; code?: string }).message ??
          (err as { code?: string }).code ??
          "UNKNOWN"
      ),
      {
        code: (err as { code?: string }).code,
        status: res.status,
      }
    );
    throw e;
  }
  return res.json() as Promise<GetOrganisationProfileResponse>;
}

export async function updateOrganisationProfile(
  data: UpdateOrganisationProfileRequest
): Promise<UpdateOrganisationProfileResponse> {
  const res = await fetch("/api/organisation/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ code: "UNKNOWN" }));
    const e = Object.assign(
      new Error(
        (err as { message?: string; code?: string }).message ??
          (err as { code?: string }).code ??
          "UNKNOWN"
      ),
      {
        code: (err as { code?: string }).code,
        status: res.status,
      }
    );
    throw e;
  }
  return res.json() as Promise<UpdateOrganisationProfileResponse>;
}

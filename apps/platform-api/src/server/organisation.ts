import { NotFoundError, ValidationError, toSafeResponse } from "@platform/platform-errors";
import { UpdateOrganisationProfileRequestSchema } from "@platform/contracts-organisation";
import { getOrganisationProfile, updateOrganisationDisplayName } from "../usecases/organisation.ts";
import { createOrganisationDependencies } from "./dependencies.ts";
import type { PipelineHandler } from "./pipeline.ts";

export const handleGetOrganisationProfile: PipelineHandler = async (req, res) => {
  const organisationId = req.context.organisationId;
  if (!organisationId) {
    res.json(400, toSafeResponse(new ValidationError("Missing organisationId in session context")));
    return;
  }
  try {
    const profile = await getOrganisationProfile(
      { organisationId },
      createOrganisationDependencies()
    );
    res.json(200, profile);
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.json(404, toSafeResponse(err));
    } else {
      throw err;
    }
  }
};

export const handlePatchOrganisationProfile: PipelineHandler = async (req, res) => {
  const organisationId = req.context.organisationId;
  if (!organisationId) {
    res.json(400, toSafeResponse(new ValidationError("Missing organisationId in session context")));
    return;
  }
  const parsed = UpdateOrganisationProfileRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.errors[0]?.message ?? "Invalid request body";
    res.json(400, toSafeResponse(new ValidationError(msg)));
    return;
  }
  try {
    const profile = await updateOrganisationDisplayName(
      { organisationId, displayName: parsed.data.displayName },
      createOrganisationDependencies()
    );
    res.json(200, profile);
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.json(404, toSafeResponse(err));
    } else if (err instanceof ValidationError) {
      res.json(400, toSafeResponse(err));
    } else {
      throw err;
    }
  }
};

import { NotFoundError, ValidationError, toSafeResponse } from "@platform/platform-errors";
import { UpdateOrganisationProfileRequestSchema } from "@platform/contracts-organisation";
import { getOrganisationProfile, updateOrganisationDisplayName } from "../usecases/organisation.ts";
import { PostgresOrganisationRepository } from "../adapters/postgres-organisation-repository.ts";
import type { PipelineHandler } from "./pipeline.ts";

const POSTGRES_URL =
  process.env["POSTGRES_URL"] ?? "postgresql://platform:platformpassword@localhost:5433/platform";

export const handleGetOrganisationProfile: PipelineHandler = async (req, res) => {
  const organisationId = req.context.organisationId;
  if (!organisationId) {
    res.json(400, toSafeResponse(new ValidationError("Missing organisationId in session context")));
    return;
  }
  try {
    const repo = new PostgresOrganisationRepository(POSTGRES_URL);
    const profile = await getOrganisationProfile({ organisationId }, { organisations: repo });
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
    const repo = new PostgresOrganisationRepository(POSTGRES_URL);
    const profile = await updateOrganisationDisplayName(
      { organisationId, displayName: parsed.data.displayName },
      { organisations: repo }
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

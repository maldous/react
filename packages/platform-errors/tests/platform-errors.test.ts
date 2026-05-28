import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  InfrastructureError,
  UnexpectedError,
  isAppError,
  toSafeResponse,
} from "../src/index.ts";

describe("ValidationError", () => {
  it("has the correct code", () => {
    const err = new ValidationError("Invalid input");
    assert.equal(err.code, "VALIDATION_ERROR");
  });

  it("has httpStatus 400", () => {
    const err = new ValidationError("Invalid input");
    assert.equal(err.httpStatus, 400);
  });

  it("is not retryable", () => {
    const err = new ValidationError("Invalid input");
    assert.equal(err.retryable, false);
  });

  it("is an instance of AppError and Error", () => {
    const err = new ValidationError("Invalid input");
    assert.ok(err instanceof AppError);
    assert.ok(err instanceof Error);
  });
});

describe("NotFoundError", () => {
  it("has code NOT_FOUND, httpStatus 404, retryable false", () => {
    const err = new NotFoundError("Resource not found");
    assert.equal(err.code, "NOT_FOUND");
    assert.equal(err.httpStatus, 404);
    assert.equal(err.retryable, false);
  });
});

describe("ConflictError", () => {
  it("has code CONFLICT, httpStatus 409, retryable false", () => {
    const err = new ConflictError("Resource already exists");
    assert.equal(err.code, "CONFLICT");
    assert.equal(err.httpStatus, 409);
    assert.equal(err.retryable, false);
  });
});

describe("UnauthorizedError", () => {
  it("has code UNAUTHORIZED, httpStatus 401, retryable false", () => {
    const err = new UnauthorizedError("Authentication required");
    assert.equal(err.code, "UNAUTHORIZED");
    assert.equal(err.httpStatus, 401);
    assert.equal(err.retryable, false);
  });
});

describe("ForbiddenError", () => {
  it("has code FORBIDDEN, httpStatus 403, retryable false", () => {
    const err = new ForbiddenError("Access denied");
    assert.equal(err.code, "FORBIDDEN");
    assert.equal(err.httpStatus, 403);
    assert.equal(err.retryable, false);
  });
});

describe("InfrastructureError", () => {
  it("has code INFRASTRUCTURE_ERROR, httpStatus 502, retryable true", () => {
    const err = new InfrastructureError("Database unavailable");
    assert.equal(err.code, "INFRASTRUCTURE_ERROR");
    assert.equal(err.httpStatus, 502);
    assert.equal(err.retryable, true);
  });
});

describe("UnexpectedError", () => {
  it("has code UNEXPECTED_ERROR, httpStatus 500, retryable false", () => {
    const err = new UnexpectedError("Something went wrong");
    assert.equal(err.code, "UNEXPECTED_ERROR");
    assert.equal(err.httpStatus, 500);
    assert.equal(err.retryable, false);
  });
});

describe("AppError toSafeResponse", () => {
  it("includes code and message in safe response", () => {
    const err = new ValidationError("Field required", { safeDetails: { field: "email" } });
    const response = err.toSafeResponse();
    assert.equal(response.code, "VALIDATION_ERROR");
    assert.equal(response.message, "Field required");
  });

  it("includes safeDetails when provided", () => {
    const err = new ValidationError("Bad value", { safeDetails: { field: "age", min: 0 } });
    const response = err.toSafeResponse();
    assert.deepEqual(response.details, { field: "age", min: 0 });
  });

  it("does not include internalDetails in safe response", () => {
    const err = new InfrastructureError("DB error", {
      internalDetails: { query: "SELECT * FROM users", host: "db.internal" },
    });
    const response = err.toSafeResponse();
    assert.ok(!("internalDetails" in response));
    assert.ok(response.details === undefined || !("query" in (response.details ?? {})));
  });

  it("omits details key when safeDetails is not provided", () => {
    const err = new NotFoundError("Not found");
    const response = err.toSafeResponse();
    assert.ok(!("details" in response));
  });

  it("preserves the cause when wrapping an underlying error", () => {
    const cause = new Error("original cause");
    const err = new InfrastructureError("Service down", { cause });
    assert.equal(err.cause, cause);
  });
});

describe("isAppError", () => {
  it("returns true for AppError instances", () => {
    assert.ok(isAppError(new ValidationError("test")));
    assert.ok(isAppError(new NotFoundError("test")));
    assert.ok(isAppError(new InfrastructureError("test")));
  });

  it("returns false for plain Error", () => {
    assert.equal(isAppError(new Error("plain")), false);
  });

  it("returns false for non-error values", () => {
    assert.equal(isAppError("string"), false);
    assert.equal(isAppError(null), false);
    assert.equal(isAppError(undefined), false);
    assert.equal(isAppError(42), false);
  });
});

describe("toSafeResponse helper", () => {
  it("delegates to AppError.toSafeResponse for app errors", () => {
    const err = new ForbiddenError("Access denied");
    const response = toSafeResponse(err);
    assert.equal(response.code, "FORBIDDEN");
    assert.equal(response.message, "Access denied");
  });

  it("returns UNEXPECTED_ERROR for unknown errors", () => {
    const response = toSafeResponse(new Error("unknown"));
    assert.equal(response.code, "UNEXPECTED_ERROR");
  });

  it("returns UNEXPECTED_ERROR for non-error values", () => {
    const response = toSafeResponse("not an error");
    assert.equal(response.code, "UNEXPECTED_ERROR");
  });
});

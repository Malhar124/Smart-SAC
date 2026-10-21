import { Router } from "express";
import { registry, ResponseEnvelope, errorResponse } from "./openapi.js";
import { ApiError } from "../utils/ApiError.js";
import { requireUser, requireAdmin, requireAccount } from "../middlewares/auth.middleware.js";

const AUTH = { user: requireUser, admin: requireAdmin, any: requireAccount };

const toOpenApiPath = (path) => path.replace(/:(\w+)/g, "{$1}");

/**
 * Validates params, query and body against Zod schemas and replaces them with the parsed values
 * (trimmed, coerced, defaults applied). Fails with 400 and one entry per problem field.
 */
export const validateRequest =
  ({ body, query, params }) =>
  (req, res, next) => {
    const errors = [];
    const parse = (schema, value, location) => {
      if (!schema) return value;
      const result = schema.safeParse(value ?? {});
      if (result.success) return result.data;
      for (const issue of result.error.issues) {
        errors.push({ path: issue.path.join("."), location, message: issue.message });
      }
      return value;
    };

    const parsedParams = parse(params, req.params, "params");
    const parsedQuery = parse(query, req.query, "query");
    const parsedBody = parse(body, req.body, "body");

    if (errors.length > 0) throw new ApiError(400, errors[0].message, errors);

    req.params = parsedParams;
    // Express 5 exposes req.query as a getter; shadow it with the parsed copy
    Object.defineProperty(req, "query", { value: parsedQuery, writable: true, configurable: true, enumerable: true });
    req.body = parsedBody;
    next();
  };

/**
 * A router whose routes are validated and documented from one definition:
 *
 *   routes.post("/book-room", { summary, auth: "user", body: BookRoomBody }, handler)
 *
 * registers the Express route (rate limit -> auth -> validation -> handler) and the matching
 * OpenAPI operation, so the docs at /api/docs can't drift from what the server accepts.
 */
export const createRoutes = ({ prefix, tag }) => {
  const router = Router();

  const define =
    (method) =>
    (path, spec, ...handlers) => {
      const { summary, description, auth, body, query, params, limiter, tags } = spec;
      const chain = [];
      if (limiter) chain.push(limiter);
      if (auth) chain.push(AUTH[auth]);
      if (body || query || params) chain.push(validateRequest({ body, query, params }));
      router[method](path, ...chain, ...handlers);

      registry.registerPath({
        method,
        path: prefix + toOpenApiPath(path),
        tags: tags ?? [tag],
        summary,
        description,
        security: auth ? [{ cookieAuth: [] }] : undefined,
        request: {
          ...(params && { params }),
          ...(query && { query }),
          ...(body && { body: { content: { "application/json": { schema: body } } } }),
        },
        responses: {
          200: { description: "Success", content: { "application/json": { schema: ResponseEnvelope } } },
          ...(body || query || params ? { 400: errorResponse("Invalid input; `errors` lists each problem field") } : {}),
          ...(auth ? { 401: errorResponse("Not signed in, or the session expired") } : {}),
          ...(limiter ? { 429: errorResponse("Too many attempts; retry after the Retry-After header") } : {}),
        },
      });
    };

  return {
    router,
    get: define("get"),
    post: define("post"),
    patch: define("patch"),
    delete: define("delete"),
  };
};

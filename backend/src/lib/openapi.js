import { OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { z } from "./zod.js";

export const registry = new OpenAPIRegistry();

registry.registerComponent("securitySchemes", "cookieAuth", {
  type: "apiKey",
  in: "cookie",
  name: "accessToken",
  description: "Set as an httpOnly cookie by /users/login or /admin/login",
});

export const ResponseEnvelope = registry.register(
  "ApiResponse",
  z.object({
    statusCode: z.number().int(),
    success: z.boolean(),
    message: z.string(),
    data: z.any(),
  })
);

export const ErrorBody = registry.register(
  "ApiError",
  z.object({
    success: z.literal(false),
    message: z.string(),
    errors: z
      .array(z.object({ path: z.string().optional(), message: z.string(), code: z.string().optional() }).passthrough())
      .optional(),
  })
);

export const errorResponse = (description) => ({
  description,
  content: { "application/json": { schema: ErrorBody } },
});

export const buildOpenApiDocument = () =>
  new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: "3.0.3",
    info: {
      title: "Smart SAC API",
      version: "1.0.0",
      description:
        "Backend for the IIIT Allahabad Student Activity Center: equipment lending, reservations, rooms, tickets, " +
        "chat and notifications. Every response uses the ApiResponse envelope; errors use ApiError. " +
        "Authentication is an httpOnly `accessToken` cookie set by the login endpoints; " +
        "call the matching refresh-token endpoint when a request returns 401. Live updates stream from GET /events.",
    },
    servers: [{ url: "/api/v1" }],
  });

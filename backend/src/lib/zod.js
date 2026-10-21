import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

// Adds .openapi() to Zod schemas so request schemas double as API documentation.
// Import z from here (not from "zod") in any file that defines request schemas.
extendZodWithOpenApi(z);

export { z };

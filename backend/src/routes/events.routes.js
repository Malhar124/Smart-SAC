import { createRoutes } from "../lib/route.js";
import { streamEvents } from "../controllers/features.controller.js";

const routes = createRoutes({ prefix: "", tag: "Live updates" });

routes.get(
  "/events",
  {
    summary: "Server-Sent Events stream of changes for the signed-in account",
    description:
      "Keep this open with EventSource (withCredentials). Each message is JSON with a `type` " +
      "(equipment.changed, room.changed, ticket.changed, message.new, message.read, notification.new, " +
      "notification.read, announcement.changed) plus ids. Refetch through the normal endpoints when one arrives.",
    auth: "any",
  },
  streamEvents
);

export default routes.router;

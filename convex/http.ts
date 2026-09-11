import { httpRouter } from "convex/server";
import { trackVisit, trackVisitOptions } from "./visitors";

const http = httpRouter();

http.route({
  path: "/track",
  method: "POST",
  handler: trackVisit,
});

http.route({
  path: "/track",
  method: "OPTIONS",
  handler: trackVisitOptions,
});

export default http;

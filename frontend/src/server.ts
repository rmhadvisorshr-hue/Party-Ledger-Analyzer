import "./lib/error-capture";

import { handleApiFetch } from "../../backend/apiFetch";
import { createSsrFetchHandler } from "./lib/ssr-fetch-handler";

export default createSsrFetchHandler(handleApiFetch);

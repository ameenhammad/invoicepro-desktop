// InvoicePro - Renderer entry point.
// Importing these modules attaches their DOM event listeners as a side
// effect (each module wires its own view on load); navigation.js pulls in
// every view module's load* function, so importing it (transitively)
// initializes the whole app. auth.js is imported directly for init().
import { init } from "./auth.js";
import "./navigation.js";
import "./dashboard.js";

init();

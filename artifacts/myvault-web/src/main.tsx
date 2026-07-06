import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installMockFetcher } from "./mocks/mockFetcher";

installMockFetcher();

createRoot(document.getElementById("root")!).render(<App />);

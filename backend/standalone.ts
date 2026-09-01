import { createApiApp } from "./createApp";

const app = createApiApp();
const port = Number(process.env.PORT) || 3001;

app.listen(port, () => {
  console.log(`Party Ledger Analyzer API running standalone at http://localhost:${port}`);
});

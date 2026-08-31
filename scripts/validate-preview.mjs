import path from "node:path";

import { PROJECT_ROOT, validatePreviewRepository } from "./preview-contract.mjs";

const root = process.env.ARC_PUBLIC_SEED_ROOT
  ? path.resolve(process.env.ARC_PUBLIC_SEED_ROOT) : PROJECT_ROOT;
const result = await validatePreviewRepository({ root });
process.stdout.write(
  `ARC sandbox preview contract passed: ${result.pages.length} pages, ` +
  `${result.totalBytes} bytes, repository ${result.manifest.value.repository} ` +
  `(${result.manifest.value.repository_id}).\n`
);

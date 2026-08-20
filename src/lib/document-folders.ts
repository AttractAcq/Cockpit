// Cockpit v3 Step 3 — Documents. A real folder taxonomy grouping the
// already-real 21 Context Files (CONTEXT_FILE_DEFS in types/phase.ts) into
// themed folders for browsing -- a grouping over what's already there, not
// a new content structure. Grounded in the real file titles rather than the
// original vision doc's illustrative folder list (Company/Market/
// Customers/...), which doesn't map cleanly onto content that already
// exists with its own real, more specific 21-file taxonomy.
//
// Pure and unit-tested (no React), matching the business-context-resolve.ts
// / knowledge-search.ts / finance-csv.ts precedent for logic this repo can
// test without component infrastructure.

import type { ClientContextFile } from "@/types/phase";

export interface DocumentFolder {
  key: string;
  label: string;
  /** Context File numbers (0-20, CONTEXT_FILE_DEFS) belonging to this folder. */
  fileNumbers: number[];
}

export const DOCUMENT_FOLDERS: DocumentFolder[] = [
  { key: "company", label: "Company & Business", fileNumbers: [0, 1] },
  { key: "avatar", label: "Avatar & Market", fileNumbers: [2] },
  { key: "offer_sales", label: "Offer & Sales", fileNumbers: [3, 19] },
  { key: "proof", label: "Proof", fileNumbers: [4, 5] },
  { key: "brand", label: "Brand", fileNumbers: [6, 7] },
  { key: "content_systems", label: "Content Systems", fileNumbers: [8, 9, 10, 11] },
  { key: "website", label: "Website", fileNumbers: [12] },
  { key: "distribution", label: "Distribution", fileNumbers: [13] },
  { key: "automation", label: "Automation", fileNumbers: [14] },
  { key: "calendar_performance", label: "Calendar & Performance", fileNumbers: [15, 16, 17] },
  { key: "client_relationship", label: "Client Relationship", fileNumbers: [18, 20] },
];

export interface DocumentFolderGroup {
  folder: DocumentFolder;
  contextFiles: ClientContextFile[];
}

export function groupContextFilesByFolder(files: ClientContextFile[]): DocumentFolderGroup[] {
  return DOCUMENT_FOLDERS.map((folder) => ({
    folder,
    contextFiles: files
      .filter((f) => folder.fileNumbers.includes(f.file_number))
      .sort((a, b) => a.file_number - b.file_number),
  }));
}

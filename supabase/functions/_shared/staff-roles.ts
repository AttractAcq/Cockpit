// Small dependency-free role contract for Edge Functions that only need the
// Cockpit staff authorization gate. Keeping this separate avoids importing
// asset-generation provider code solely to read the role set.
export const STAFF_ROLES = new Set(["admin", "account_manager", "editor"]);

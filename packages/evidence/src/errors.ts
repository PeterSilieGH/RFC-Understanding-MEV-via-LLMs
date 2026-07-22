export class EvidenceConflictError extends Error {
  override readonly name = "EvidenceConflictError";
}

export class EvidenceIntegrityError extends Error {
  override readonly name = "EvidenceIntegrityError";
}

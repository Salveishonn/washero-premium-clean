/** Exact-path Storage compensation for a payment-receipt capture attempt. */

export type StorageRemoveError = {
  message?: string;
  name?: string;
  statusCode?: string | number;
  error?: string;
};

export type StorageRemoveResult = {
  data?: unknown;
  error: StorageRemoveError | null;
};

export type ReceiptUploadCompensation = {
  attempted: boolean;
  succeeded: boolean;
  already_absent: boolean;
};

const MISSING_OBJECT_RE = /\b(not[ _-]?found|object not found|no such (file|object)|does not exist)\b/i;

function isMissingObjectRemoveError(error: StorageRemoveError): boolean {
  const status = String(error.statusCode ?? "").trim();
  if (status === "404") return true;

  const blob = `${error.name ?? ""} ${error.message ?? ""} ${error.error ?? ""}`;
  if (MISSING_OBJECT_RE.test(blob)) return true;

  return false;
}

/** Interpret a Storage SDK `.remove([exactPath])` response. Never treat a bare HTTP 400 as success. */
export function interpretStorageRemoveResult(result: StorageRemoveResult): {
  succeeded: boolean;
  already_absent: boolean;
} {
  if (!result.error) {
    return { succeeded: true, already_absent: false };
  }
  if (isMissingObjectRemoveError(result.error)) {
    return { succeeded: true, already_absent: true };
  }
  return { succeeded: false, already_absent: false };
}

/**
 * Remove one object this invocation uploaded. Callers must pass the exact path
 * they just uploaded — never a prefix, listing, or client-supplied path.
 */
export async function cleanupUploadedReceiptObject(opts: {
  remove: (exactPaths: string[]) => Promise<StorageRemoveResult>;
  path: string;
}): Promise<ReceiptUploadCompensation> {
  const result = await opts.remove([opts.path]);
  const interpreted = interpretStorageRemoveResult(result);
  return {
    attempted: true,
    succeeded: interpreted.succeeded,
    already_absent: interpreted.already_absent,
  };
}

export function shouldCompensateReceiptUpload(opts: {
  uploadSucceeded: boolean;
  insertSucceeded: boolean;
}): boolean {
  return opts.uploadSucceeded && !opts.insertSucceeded;
}

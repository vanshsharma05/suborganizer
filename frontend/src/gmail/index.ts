export {
  connectGmail,
  disconnectGmail,
  getGmailConnection,
  GmailAuthError,
  isGmailConfigured,
  type GmailConnection,
} from './auth';

export { applyCandidates, importCandidate, reconcileCandidate, type ImportOutcome } from './apply';

export {
  scanGmail,
  ScanCancelled,
  type Candidate,
  type ScanDepth,
  type ScanEvent,
  type ScanProgress,
  type ScanResult,
} from './scan';

export type { Cycle, EventKind } from './classify';

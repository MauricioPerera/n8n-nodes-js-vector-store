/**
 * Read-only guard for the Vector Store node.
 *
 * When the node is exposed to an AI agent (`usableAsTool: true`), a
 * prompt-injection attack can induce the agent to call write operations
 * (Upsert, Delete, Drop) and mutate or destroy the store. The `readOnly`
 * node toggle rejects every write operation before it reaches the engine.
 *
 * This module classifies an operation id as write or read so the read-only
 * guard and the router's flush-after-write logic share one source of truth
 * (no duplicated set of operation ids that can drift).
 */

/** Operation ids that mutate the store on disk. */
const WRITE_OPERATIONS = new Set<string>(['set', 'remove', 'drop', 'buildAnnIndex', 'dropAnnIndex']);

/**
 * Whether an operation id mutates the store.
 *
 * Write: `set` (Upsert), `remove` (Delete), `drop` (Drop Collection),
 *        `buildAnnIndex` (writes `<col>.ivf.json`), `dropAnnIndex` (deletes it).
 * Read:  `search`, `get`, `count`, `collections`, `matryoshkaSearch`,
 *        `searchAcross` — and any unknown id defaults to read (the router's
 *        `default` switch branch rejects unknown ids separately, so a
 *        misclassified unknown never reaches the engine).
 */
export function isWriteOperation(operation: string): boolean {
	return WRITE_OPERATIONS.has(operation);
}
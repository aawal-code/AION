/**
 * Command input sanitizer and validator
 * Enforces strict whitelisting and rejects shell metacharacters
 */

export class InvalidCommandError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'InvalidCommandError';
    this.statusCode = statusCode;
  }
}

const ALLOWED_ACTIONS = new Set(['lock', 'sleep', 'kill_process']);
const FORBIDDEN_METACHARS_REGEX = /[&|;`$<>\r\n]/;
const TARGET_WHITELIST_REGEX = /^[a-zA-Z0-9_\-\.]+$/;

export function sanitizeCommand(action, target = '') {
  if (!action || typeof action !== 'string') {
    throw new InvalidCommandError('Action must be a non-empty string');
  }

  const cleanAction = action.trim();
  if (!ALLOWED_ACTIONS.has(cleanAction)) {
    throw new InvalidCommandError(
      `Disallowed action '${cleanAction}'. Permitted actions: lock, sleep, kill_process`
    );
  }

  if (typeof target !== 'string') {
    throw new InvalidCommandError('Target must be a string');
  }

  const cleanTarget = target.trim();

  // Guard against shell metacharacters in both action and target
  if (FORBIDDEN_METACHARS_REGEX.test(cleanAction) || FORBIDDEN_METACHARS_REGEX.test(cleanTarget)) {
    throw new InvalidCommandError('Command rejected: contains disallowed shell metacharacters');
  }

  // Strict validation for process killing
  if (cleanAction === 'kill_process') {
    if (!cleanTarget) {
      throw new InvalidCommandError('Target process name is required for kill_process');
    }
    if (!TARGET_WHITELIST_REGEX.test(cleanTarget)) {
      throw new InvalidCommandError(
        `Invalid process target '${cleanTarget}'. Must only contain alphanumeric characters, underscores, hyphens, and periods.`
      );
    }
  }

  return { action: cleanAction, target: cleanTarget };
}

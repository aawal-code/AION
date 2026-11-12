/**
 * Command input sanitizer and validator
 * Enforces strict whitelisting, rejects shell metacharacters, and normalizes process targets
 */

export class InvalidCommandError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'InvalidCommandError';
    this.statusCode = statusCode;
  }
}

const ALLOWED_ACTIONS = new Set(['lock', 'sleep', 'screen_off', 'shutdown', 'kill_process']);
const FORBIDDEN_METACHARS_REGEX = /[&|;`$<>\r\n]/;
// Whitelist letters, numbers, underscores, dashes, dots, and optional single spaces between words
const TARGET_WHITELIST_REGEX = /^[a-zA-Z0-9_\-\.]+(?:\s+[a-zA-Z0-9_\-\.]+)*$/;

export function sanitizeCommand(action, target = '') {
  if (!action || typeof action !== 'string') {
    throw new InvalidCommandError('Action must be a non-empty string');
  }

  const cleanAction = action.trim();
  if (!ALLOWED_ACTIONS.has(cleanAction)) {
    throw new InvalidCommandError(
      `Disallowed action '${cleanAction}'. Permitted actions: ${Array.from(ALLOWED_ACTIONS).join(', ')}`
    );
  }

  if (typeof target !== 'string') {
    throw new InvalidCommandError('Target must be a string');
  }

  let cleanTarget = target.trim();
  // Strip optional matching outer quotes if passed from user inputs
  if (
    (cleanTarget.startsWith('"') && cleanTarget.endsWith('"')) ||
    (cleanTarget.startsWith("'") && cleanTarget.endsWith("'"))
  ) {
    cleanTarget = cleanTarget.slice(1, -1).trim();
  }

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
        `Invalid process target '${cleanTarget}'. Must only contain alphanumeric characters, underscores, hyphens, periods, or spaces.`
      );
    }
  }

  return { action: cleanAction, target: cleanTarget };
}

class AppError extends Error {
  constructor(message, options = {}) {
    super(String(message || 'An internal error occurred.'));
    this.name = 'AppError';
    this.code = options.code || 'INTERNAL_ERROR';
    this.publicMessage = options.publicMessage || String(message || 'An internal error occurred.');
    this.status = options.status || 500;
    this.details = options.details;
    if (Error.captureStackTrace) Error.captureStackTrace(this, AppError);
  }
}

function createValidationError(message, publicMessage) {
  return new AppError(message, {
    code: 'VALIDATION_ERROR',
    publicMessage: publicMessage || message || 'Invalid input provided.',
    status: 400,
  });
}

function createPermissionError(publicMessage) {
  return new AppError(publicMessage || 'You do not have permission to perform this action.', {
    code: 'PERMISSION_ERROR',
    publicMessage: publicMessage || 'You do not have permission to perform this action.',
    status: 403,
  });
}

function createCooldownError(retryAfterSeconds) {
  return new AppError('Command is on cooldown.', {
    code: 'COOLDOWN_ERROR',
    publicMessage: `Slow down 🙂 Try again in ${retryAfterSeconds}s.`,
    status: 429,
    details: { retryAfterSeconds },
  });
}

function createModuleDisabledError(moduleKey) {
  return new AppError('This module is disabled for the guild.', {
    code: 'MODULE_DISABLED',
    publicMessage: `❌ This module is disabled: **${moduleKey}**`,
    status: 403,
  });
}

function createSafeModeError(kind, name, disabledUntil) {
  return new AppError('This command is temporarily disabled by safe mode.', {
    code: 'SAFE_MODE_BLOCKED',
    publicMessage: `🛡️ This ${kind} is temporarily disabled due to errors. Try again ${disabledUntil ? `<t:${Math.floor(disabledUntil / 1000)}:R>` : 'later'}.`,
    status: 429,
    details: { kind, name, disabledUntil },
  });
}

function isAppError(err) {
  return err instanceof AppError;
}

module.exports = {
  AppError,
  createValidationError,
  createPermissionError,
  createCooldownError,
  createModuleDisabledError,
  createSafeModeError,
  isAppError,
};
const {
  AppError,
  createValidationError,
  createPermissionError,
  createCooldownError,
  createModuleDisabledError,
  createSafeModeError,
  isAppError,
} = require('./AppError');

function getPublicMessage(err) {
  if (err instanceof AppError) return err.publicMessage;
  return '❌ An unexpected error occurred. Please try again later.';
}

function wrapError(err, options = {}) {
  if (err instanceof AppError) return err;
  return new AppError(err?.message || String(err), options);
}

module.exports = {
  AppError,
  createValidationError,
  createPermissionError,
  createCooldownError,
  createModuleDisabledError,
  createSafeModeError,
  isAppError,
  getPublicMessage,
  wrapError,
};
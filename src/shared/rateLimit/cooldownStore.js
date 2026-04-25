class CooldownStore {
  constructor() {
    this.state = new Map();
  }

  _getKey(commandKey) {
    return String(commandKey || 'default');
  }

  _getUserMap(commandKey) {
    const key = this._getKey(commandKey);
    if (!this.state.has(key)) {
      this.state.set(key, new Map());
    }
    return this.state.get(key);
  }

  isOnCooldown(commandKey, userId, cooldownSeconds) {
    if (!cooldownSeconds || cooldownSeconds <= 0) return { ok: true };
    const users = this._getUserMap(commandKey);
    const now = Date.now();
    const expiresAt = (users.get(userId) ?? 0) + cooldownSeconds * 1000;
    if (now < expiresAt) {
      return { ok: false, retryAfterMs: expiresAt - now };
    }
    users.set(userId, now);
    return { ok: true };
  }

  reset(commandKey, userId) {
    const users = this._getUserMap(commandKey);
    users.delete(userId);
  }
}

module.exports = { CooldownStore };
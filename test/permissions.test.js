const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');

const { isStaff } = require('../src/utils/isStaff');

function fakeMember({ roles = [], admin = false, manageGuild = false } = {}) {
  return {
    roles: { cache: new Set(roles) },
    permissions: {
      has(flag) {
        if (flag === PermissionFlagsBits.Administrator) return admin;
        if (flag === PermissionFlagsBits.ManageGuild) return manageGuild;
        return false;
      },
    },
  };
}

test('isStaff true when member has adminRoleId', () => {
  const settings = { tickets: { adminRoleId: 'A', modRoleId: 'M' } };
  assert.equal(isStaff(fakeMember({ roles: ['A'] }), settings), true);
});

test('isStaff true when member has modRoleId', () => {
  const settings = { tickets: { adminRoleId: 'A', modRoleId: 'M' } };
  assert.equal(isStaff(fakeMember({ roles: ['M'] }), settings), true);
});

test('isStaff fallback to ManageGuild', () => {
  const settings = { tickets: { adminRoleId: 'A', modRoleId: 'M' } };
  assert.equal(isStaff(fakeMember({ manageGuild: true }), settings), true);
});

test('isStaff false when no roles and no perms', () => {
  const settings = { tickets: { adminRoleId: 'A', modRoleId: 'M' } };
  assert.equal(isStaff(fakeMember({}), settings), false);
});

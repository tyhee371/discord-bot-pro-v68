
const { Events } = require('discord.js');
const { restore247ForClient } = require('../services/musicService');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    // Restore 24/7 connections
    await restore247ForClient(client);
  },
};

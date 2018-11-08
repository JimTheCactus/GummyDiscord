const core = require('../../core')
const fs = require('fs');
const { closeSync, openSync } = require('fs');

const touch = filename => closeSync(openSync(filename, 'w'))


core.on('command_kickbridge', function (client, message, cmdline) {
    if (core.config.modroleid) {
        if (message.member.roles.has(core.config.modroleid)) {
            core.emit('log', "User " + core.getFullName(message.author) + " kicked the bridge.", core.loglevels.warn);
            touch("/home/kb0lzu/dirc/reboot.js");
            message.reply("Command to restart the bridge issued.");
        } else {
            message.reply("Access Denied.");
            core.emit('log', "User " + core.getFullName(message.author) + " was denied access to kick the bridge.", core.loglevels.warn);
        }
    }
});

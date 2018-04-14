// Import the discord.js module
const Discord = require('discord.js');
const fs = require('fs');
const EventEmitter = require('events');
class CoreClass extends EventEmitter {
    setLogLevel(level) {
        this.loglevel = level;
    }
    getFullName(user) {
        return '@' + user.username + '#' + user.discriminator;
    }

    getSenderNickname(message) {
        if (message.guild) {
            return new Promise(function (resolve, reject) {
                message.guild.fetchMember(message.author).then((guildie) => {
                    if (guildie) {
                        if (guildie.nickname) {
                            resolve(guildie.nickname);
                        } else {
                            resolve(this.getFullName(message.author));
                        }
                    }
                    else {
                        resolve(this.getFullName(message.author));
                    }
                });
            });
        }
        else {
            return Promise.resolve(this.getFullName(message.author));
        }
    }

    constructor() {
        super();

        // cache a compiled copy of our argument processor regex
        this.config = undefined;
        this.client = undefined;
        this.loglevels = Object.freeze({ "error": 1, "warn": 2, "info": 3, "debug": 4})
        this.loglevel = this.loglevels.debug; // Default to logging everything.
        this.argprocessor = /\s*(\S+)(\s+|$)/g;

        this.on('log', function (message, level) {
            // Default log handler.
            if (level <= this.loglevel) {
                console.log(message);
            }
        });

        this.emit('log', 'Loading config...', this.loglevels.info);
        this.config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

        if (this.config.loglevel) {
            this.loglevel = this.loglevels[this.config.loglevel];
        }
        
        // Create an instance of a Discord client
        this.client = new Discord.Client();

        // The ready event is vital, it means that your bot will only start reacting to information
        // from Discord _after_ ready is emitted
        this.client.on('ready', () => {
            // Create the regex for finding lines that start with a mention of us.
            this.commandstart = new RegExp('^<@' + this.client.user.id + '>\s*', 'g');
            this.emit('connected', this.client);
            this.emit('log', 'Connected to Discord.', this.loglevels.info);
        });

        this.client.on('message', message => {
            // If this message isn't on our channel of interest, bail.
            if (message.channel.id != this.config.activechannel && message.channel.type == "text") return;
            // No reason to bang on the database about myself.
            if (message.author.id == this.client.user.id) return;
            if (this.config.ignoredusers) {
                for (var i = 0; i < this.config.ignoredusers.length; i++) {
                    if (message.author.id == this.config.ignoredusers[i]) return;
                }
            }

            this.emit('log', 'Got message on channel "' + message.channel.name + '" with ID "' + message.channel.id + '" from user "' + this.getFullName(message.author) + '"', this.loglevels.debug);

            this.emit('channel_message', this.client, message);

            // Make sure it starts at the beginning.
            this.commandstart.lastIndex = 0;
            // Check if this starts with a mention of us.
            if (this.commandstart.test(message.content)) {
                var cmdline = message.content.substring(this.commandstart.lastIndex);
                this.emit('log', "Got command: " + cmdline, this.loglevels.debug);

                // Reset the argument processor
                this.argprocessor.lastIndex = 0;
                var nick = this.getFullName(message.author);
                var arg = this.argprocessor.exec(cmdline);
                if (arg) {
                    var cmd = arg[1].toLowerCase();
                    this.emit('command_' + cmd, this.client, message, cmdline);
                }
            }

        });

        // Debug listener for connect messages
        this.on('connected', function (client) {
            this.emit('log', 'Received connected event.', this.loglevels.debug);
        });

        // Debug listener for channel messages
        this.on('channel_message', function (client, message) {
            this.emit('log', 'Got message event: ' + message.content, this.loglevels.debug);
        });

        // Quick ping command to prove the core's alive and well.
        this.on('command_ping', function (client, message, cmdline) {
            message.reply('*pongs*');
        });
    }

    connect() {
        this.emit('log', 'Connecting to Discord...', this.loglevels.info);
        // Log our bot in
        this.client.login(this.config.token);
    }
}

var my_core = new CoreClass();

module.exports = my_core;

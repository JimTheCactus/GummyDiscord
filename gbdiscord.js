// Import the discord.js module
const Discord = require('discord.js');
const fs = require('fs');
const mysql = require('mysql');

// cache a compiled copy of our argument processor regex
var commandstart;
var argprocessor = /\s*(\S+)(\s+|$)/g;

console.log('Loading config...');
var config = JSON.parse(fs.readFileSync('config.json', 'utf8')); 

console.log('Connecting to database server...');
var conpool = mysql.createPool({
    host: config.mysql.hostname,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database
});

// Create an instance of a Discord client
const client = new Discord.Client();

function getFullName(user) {
    return '@' + user.username + '#' + user.discriminator;
}

function getSenderNickname(message) {
    if(message.guild) {
        return new Promise(function (resolve, reject) {
            message.guild.fetchMember(message.author).then((guildie) => { 
                if (guildie) {
                    if (guildie.nickname) {
                        resolve(guildie.nickname);
                    } else {
                        resolve(getFullName(message.author));
                    }
                }
                else {
                    resolve(getFullName(message.author));
                }
            });
        });
    }
    else {
        return Promise.resolve(getFullName(message.author));
    }
}

function doQuery(sql, callback) {
    console.log('SQL: ' + sql);
    conpool.getConnection(function(err,con) {
        if (err) throw err;
            con.query(sql, function(err, results, fields) {
                con.release();
                callback(err,results,fields);
        });
    });
}

function getNickgroupFromNick(nick, callback) {
    var sql = 'SELECT NickGroup FROM ' + config.mysql.databaseprefix + 'nickgroups WHERE Nick=?';
    // Clean up the query
    sql = mysql.format(sql,[nick]);
    doQuery(sql,function(err, results, fields) {
        if (err) throw err;
        if (results.length == 0) {
	    console.log('No group for ' + nick);
            callback(null);
        }
        else {
	    console.log(nick + ' is part of ' + results[0].NickGroup);
            callback(results[0].NickGroup);
        }
    });
}

// The ready event is vital, it means that your bot will only start reacting to information
// from Discord _after_ ready is emitted
client.on('ready', () => {
    console.log('I am ready!');
    // Create the regex for finding lines that start with a mention of us.
    commandstart = new RegExp('^<@'+client.user.id+'>\s*','g');
});

function deleteMemo(memoid) {
    sql = 'DELETE FROM ' + config.mysql.databaseprefix + 'memos WHERE ID=?';
    sql = mysql.format(sql, [memoid]);
    doQuery(sql,(err, results, fields) => {});
}

function deliverMemosForSender(message) {
    var nick = getFullName(message.author);
    var sendername = nick;
    if (message.member) {
        sendername = message.member.nickname;
    }
    getNickgroupFromNick(nick,function(group){
        var sql = ""
        if (group) {
            sql = 'SELECT ID, Nick, SourceNick, DeliveryMode, CreatedTime, Message FROM ' + config.mysql.databaseprefix + 'memos WHERE (nick=? OR nick=?) AND (NotBefore <= NOW() OR NotBefore IS NULL)';
	    sql = mysql.format(sql,[nick,group]);
        } else {
            sql = 'SELECT ID, Nick, SourceNick, DeliveryMode, CreatedTime, Message FROM ' + config.mysql.databaseprefix + 'memos WHERE nick=? AND (NotBefore <= NOW() OR NotBefore IS NULL)';
	    sql = mysql.format(sql,[nick]);
        }
        doQuery(sql,function(err, results, fields) {
            if (results.length == 0) return;

            sentheader = false;
            sentprivheader = false;
            for(var i=0;i<results.length;i++) {
                var memo = results[i];
                var memotext = '[' + memo.CreatedTime.getFullYear().toString() + '-' + (memo.CreatedTime.getMonth()+1).toString() + '-' + memo.CreatedTime.getDate()
                                + ' ' + memo.CreatedTime.getHours().toString() + ':' + memo.CreatedTime.getMinutes().toString() + '] '
                               + memo.SourceNick + ': ' + memo.Message;
             
                if (memo.DeliveryMode == "PRIV") {
                    Promise.all([message.author.createDM(),memo.ID,memotext]).then((chanandid) => {
                        var target = chanandid[0];
                        var id = chanandid[1];
                        var text = chanandid[2];
                        if (!sentprivheader && !(message.channel.type=="dm" && sentheader)) {                        
                            target.send('*Opens his mouth and prints out a tickertape addressed to you*');
                            sentprivheader = true;
                        }
                        Promise.all([target.send(text),id]).then((values) => {deleteMemo(values[1])}, (err) => {throw err});
                   });
                } else {
                    if (!sentheader && !(message.channel.type=="dm" && sentprivheader)) {
                        message.channel.send('*Opens his mouth and prints out a tickertape addressed to <@' + message.author.id + '>*');
                        sentheader = true;
                    }
                    Promise.all([message.channel.send(memotext),(memo.ID)]).then((values) => {deleteMemo(values[1])}, (err) => {throw err});
                }
            }
        });
  });
}

function getGreedyDestination(target) {
    return new Promise(function(resolve,reject) {
        // If it has the direct delivery prefix
        if (target.startsWith("-")) {
            // Trim off the prefix and return that.
            resolve(target.substring(1).toLowerCase());
        }
        else {
            // Otherwise, grab the 
            getNickgroupFromNick(target,(group) => {
                if (group) {
                    resolve(group);
                }
                else {
                    resolve(target.toLowerCase());
               }
    
            });
        }
    });
}

function add_memo(target, sender, message, mode = null) {
    return new Promise(function(resolve,reject) {
        var sql = 'INSERT INTO ' + config.mysql.databaseprefix + 'memos (Nick, SourceNick, DeliveryMode, CreatedTime, Message) VALUES (?,?,?,NOW(),?)';

        sql = mysql.format(sql,[target,sender,mode,message]);
        doQuery(sql,(err, results, fields) => {
            if(err) {
                console.log(err);
                reject(err);
            } else {
                resolve(true);
            }
        });
    });
}

client.on('message', message => {
    // If this message isn't on our channel of interest, bail.
    if (message.channel.id != config.activechannel && message.channel.type == "text") return;
    // No reason to bang on the database about myself.
    if (message.author.id == client.user.id) return;
    if (config.ignoredusers) {
        for (var i=0;i<config.ignoredusers.length;i++) {
            if (message.author.id == config.ignoredusers[i]) return;
        }
    }

    console.log('Got message on channel "' + message.channel.name + '" with ID "' + message.channel.id + '" from user "' + getFullName(message.author) + '"');

    deliverMemosForSender(message);

    // Make sure it starts at the beginning.
    commandstart.lastIndex=0;
    // Check if this starts with a mention of us.
    if (commandstart.test(message.content)) {
        var cmdline = message.content.substring(commandstart.lastIndex);
        console.log("Got command: " + cmdline);

        // Reset the argument processor
        argprocessor.lastIndex=0;
        var nick = getFullName(message.author);
        var arg = argprocessor.exec(cmdline);
        if (arg) {
            var cmd = arg[1].toLowerCase();
            if (cmd == "join") {
                arg = argprocessor.exec(cmdline);
                if (arg) {
                    var targetgroup = arg[1];
                        getNickgroupFromNick(targetgroup,function(group){
                        var sql = 'INSERT INTO ' + config.mysql.databaseprefix + 'nickgrouprequests (Nick, Nickgroup) VALUES(?,?) ON DUPLICATE KEY UPDATE NickGroup=?';
                        sql = mysql.format(sql,[nick,group,group]);
                        doQuery(sql,function(err,results,fields){
                            if (err) {
                                message.reply('An error occured. I was unable to create your link request.');
                                console.log(err);
                                return;
                            }
                            message.reply('A link request has been created for you. Log into IRC and send "!gb link auth ' + nick + '" to authorize the request.');
                        });
                    });
                }
            }
            else if (cmd == "memo") {
                var target = argprocessor.exec(cmdline);
             
                var memotext = cmdline.substring(argprocessor.lastIndex);
                if (memotext.trim() == "") return;

                Promise.all([getGreedyDestination(target[1]),getSenderNickname(message)]).then(args => {
                    console.log("Sending memo to " + args[0] + " from " + args[1] + " with the text:" + memotext);
                    add_memo(args[0], args[1], memotext).then((result) => {
                        message.reply('Memo sent!');
                    }, err => {
                        console.log("Error sending memo!");
                        console.log(err);
                        message.reply('Error sending memo. Memo was not sent.');
                    });
                });
            }
            else if (cmd == "ping") {
                message.reply('*pongs*');
            }
        }
    }
  
});

console.log('Connecting to Discord...');
// Log our bot in
client.login(config.token);

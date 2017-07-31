// Import the discord.js module
const Discord = require('discord.js');
const fs = require('fs');
const mysql = require('mysql');


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
                console.log('Parsing line ' + i.toString() + ' for memo ID ' + memo.ID.toString());
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

client.on('message', message => {
    // If this message isn't on our channel of interest, bail.
    if (message.channel.id != config.activechannel && message.channel.type == "text") return;
    // No reason to bang on the database about myself.
    if (message.author.id == client.user.id) return;
    if (config.ignoredusers) {
        for (var i=0;i<config.ignoredusers.length;i++) {
            console.log('Checking ' + message.author.id + ' against ' + config.ignoredusers[i]);
            if (message.author.id == config.ignoredusers[i]) return;
        }
    }

    console.log('Got message on channel "' + message.channel.name + '" with ID "' + message.channel.id + '" from user "' + getFullName(message.author));
  
    deliverMemosForSender(message);

});

// Do stuff


console.log('Connecting to Discord...');
// Log our bot in
client.login(config.token);

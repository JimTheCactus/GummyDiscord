const core = require('../../core');
const mysql = require('mysql');

var conpool;

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
    var sql = 'SELECT NickGroup FROM ' + core.config.mysql.databaseprefix + 'nickgroups WHERE Nick=?';
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

function deleteMemo(memoid) {
    sql = 'DELETE FROM ' + core.config.mysql.databaseprefix + 'memos WHERE ID=?';
    sql = mysql.format(sql, [memoid]);
    doQuery(sql,(err, results, fields) => {});
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
        var sql = 'INSERT INTO ' + core.config.mysql.databaseprefix + 'memos (Nick, SourceNick, DeliveryMode, CreatedTime, Message) VALUES (?,?,?,NOW(),?)';

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

function process_message(client,message) {
    var nick = core.getFullName(message.author);
    var sendername = nick;

    if (message.member) {
        sendername = message.member.nickname;
    }

    getNickgroupFromNick(nick, function (group) {
        var sql = ""
        if (group) {
            sql = 'SELECT ID, Nick, SourceNick, DeliveryMode, CreatedTime, Message FROM ' + core.config.mysql.databaseprefix + 'memos WHERE (nick=? OR nick=?) AND (NotBefore <= NOW() OR NotBefore IS NULL)';
            sql = mysql.format(sql, [nick, group]);
        } else {
            sql = 'SELECT ID, Nick, SourceNick, DeliveryMode, CreatedTime, Message FROM ' + core.config.mysql.databaseprefix + 'memos WHERE nick=? AND (NotBefore <= NOW() OR NotBefore IS NULL)';
            sql = mysql.format(sql, [nick]);
        }
        doQuery(sql, function (err, results, fields) {
            if (results.length == 0) return;

            sentheader = false;
            sentprivheader = false;
            for (var i = 0; i < results.length; i++) {
                var memo = results[i];
                var memotext = '[' + memo.CreatedTime.getFullYear().toString() + '-' + (memo.CreatedTime.getMonth() + 1).toString() + '-' + memo.CreatedTime.getDate()
                    + ' ' + memo.CreatedTime.getHours().toString() + ':' + memo.CreatedTime.getMinutes().toString() + '] '
                    + memo.SourceNick + ': ' + memo.Message;

                if (memo.DeliveryMode == "PRIV") {
                    Promise.all([message.author.createDM(), memo.ID, memotext]).then((chanandid) => {
                        var target = chanandid[0];
                        var id = chanandid[1];
                        var text = chanandid[2];
                        if (!sentprivheader && !(message.channel.type == "dm" && sentheader)) {
                            target.send('*Opens his mouth and prints out a tickertape addressed to you*');
                            sentprivheader = true;
                        }
                        Promise.all([target.send(text), id]).then((values) => { deleteMemo(values[1]) }, (err) => { throw err });
                    });
                } else {
                    if (!sentheader && !(message.channel.type == "dm" && sentprivheader)) {
                        message.channel.send('*Opens his mouth and prints out a tickertape addressed to <@' + message.author.id + '>*');
                        sentheader = true;
                    }
                    Promise.all([message.channel.send(memotext), (memo.ID)]).then((values) => { deleteMemo(values[1]) }, (err) => { throw err });
                }
            }
        });
    });
}

core.on('command_join', function (client, message, cmdline) {
    arg = core.argprocessor.exec(cmdline);
    if (arg) {
        var targetgroup = arg[1];
        getNickgroupFromNick(targetgroup, function (group) {
            var sql = 'INSERT INTO ' + core.config.mysql.databaseprefix + 'nickgrouprequests (Nick, Nickgroup) VALUES(?,?) ON DUPLICATE KEY UPDATE NickGroup=?';
            sql = mysql.format(sql, [nick, group, group]);
            doQuery(sql, function (err, results, fields) {
                if (err) {
                    message.reply('An error occured. I was unable to create your link request.');
                    console.log(err);
                    return;
                }
                message.reply('A link request has been created for you. Log into IRC and send "!gb link auth ' + nick + '" to authorize the request.');
            });
        });
    }
});

core.on('command_memo', function (client, message, cmdline) {
    var target = core.argprocessor.exec(cmdline);

    var memotext = cmdline.substring(core.argprocessor.lastIndex);
    if (memotext.trim() == "") return;

    Promise.all([getGreedyDestination(target[1]), core.getSenderNickname(message)]).then(args => {
        console.log("Sending memo to " + args[0] + " from " + args[1] + " with the text:" + memotext);
        add_memo(args[0], args[1], memotext).then((result) => {
            message.reply('Memo sent!');
        }, err => {
            console.log("Error sending memo!");
            console.log(err);
            message.reply('Error sending memo. Memo was not sent.');
        });
    });
});

console.log('Connecting to database server...');
conpool = mysql.createPool({
    host: core.config.mysql.hostname,
    user: core.config.mysql.user,
    password: core.config.mysql.password,
    database: core.config.mysql.database
});

core.on('channel_message', process_message);

console.log('Memo module initialized.');

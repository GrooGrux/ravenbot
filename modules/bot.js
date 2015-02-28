/**
 * Created by Ady on 12/30/2014.
 */

var Q = require('q');
const _ = require('underscore');
var giphy = require('./giphy.js')('dc6zaTOxFJmzC');
var chuckJokes = require('./chuckJokes.js');
var sheetsData = require('./sheets.js');
var mongoData = require('./data/mongoData.js')(process.env['MONGOLAB_URI']);
var roomPrefs = require('./data/roomPrefs.js');
var guildData = require('./data/guildData.js');
var Player = require('./player_cls.js');
var Players = require('./players.js');
var BotBase = require('./botBase.js').BotBase;
var utils = require('./utils.js');

var Bot = BotBase.extend(function () {


            return {
                /* options :
                 {
                 "bot_id": "1234567890",
                 "group_id": "1234567890",
                 "name": "hal9000",
                 "avatar_url": "http://i.groupme.com/123456789",
                 "callback_url": "http://example.com/bots/callback"
                 }
                 */
                init: function (options, roomId) {
                    this.options = options;
                    this.roomId = roomId;
                    this.ctx = {
                        players: []
                    };

                    console.log('new bot **', this.options, this.roomId);
                },
                getRoomPrefs: function () {
                    return roomPrefs.getRoomPrefs(this.roomId);
                },
                handleMessage: function (msg) {
                    /*{
                     "id": "1234567890",
                     "source_guid": "GUID",
                     "created_at": 1302623328,
                     "user_id": "1234567890",
                     "group_id": "1234567890",
                     "name": "John",
                     "avatar_url": "http://i.groupme.com/123456789",
                     "text": "Hello world ☃☃",
                     "system": true,
                     "favorited_by": [
                     "101",
                     "66",
                     "1234567890"
                     ],
                     "attachments": []
                     }*/
                    if (!msg.system) {
                        try {
                            this.mainSwitch(msg.text.trim(), msg);
                        }
                        catch (e) {
                            console.log('-------->', e, ' <<---');
                        }
                    }
                },

                mainSwitch: function (txt, msg) {
                    var self = this;
                    var caseSensitiveTxt = txt.trim();
                    txt = txt.toLowerCase().trim();
                    var ctxPlayer = this.getCtxPlayer(msg.user_id);

                    if (this.handleCtxPlayer(caseSensitiveTxt, msg)) {
                        return;
                    }

                    if (/^hello$/.test(txt)) {
                        this.postMessage('Hey there!');
                    }

                    if (/^all\stargets$/.test(txt)) {
                        this.getRoomPrefs().then(function (roomData) {
                            if (roomData.warData.inWar == true) {
                                self.getGuildData(roomData.warData.guildName).then(function (data) {
                                    var guild = data.foundGuild;
                                    var ownData = data.ownData;
                                    self.sendGuildTargets([], roomData.warData.guildName, guild, ownData, true);
                                });
                            } else {
                                this.postMessage('not in war! use matched command to issue a match');
                            }
                        }.bind(this));
                    }

                    if (/^manual$/.test(txt)) {
                        this.postMessage('Raven Manual:\nhttps://docs.google.com/document/d/15naOzWKf9z9CT-D4hHZTryTE55l4HyNiR8sahye0TzU/edit');
                    }

                    if (/^targets2$/.test(txt)) {
                        this.getRoomPrefs().then(function (roomData) {
                            if (roomData.warData.inWar == true) {
                                this.sendGuildTargetsUnified(roomData.warData.guildName);
                            }
                        }.bind(this));
                    }

                    if (/^targets$/.test(txt)) {
                        this.getRoomPrefs().then(function (roomData) {
                            if (roomData.warData.inWar == true) {
                                self.getGuildData(roomData.warData.guildName).then(function (data) {
                                    var guild = data.foundGuild;
                                    var ownData = data.ownData;
                                    self.sendGuildTargets([], roomData.warData.guildName, guild, ownData, false);
                                });
                            } else {
                                this.postMessage('not in war! use matched command to issue a match');
                            }
                        }.bind(this));
                    }

                    if (/^time$/.test(txt)) {
                        this.getRoomPrefs().then(function (roomData) {
                            if (roomData.warData.inWar == true) {
                                var diff = new Date(Date.now() - roomData.warData.warTime);
                                this.postMessage(60 - diff.getMinutes() + ' minutes left.');
                            } else {
                                this.postMessage('not in war.');
                            }
                        }.bind(this));
                    }

                    var syncRgx = /^[Ss]ync\s(\d+)$/;
                    if (syncRgx.test(txt)) {
                        var mtch = syncRgx.exec(txt);
                        this.getRoomPrefs().then(function (roomData) {
                            if (roomData.warData.inWar == true) {
                                try {
                                    var newTime = new Date(new Date().getTime() - (60 - Number(mtch[1])) * 60000);
                                }
                                catch (e) {
                                    console.log(e);
                                }
                                roomData.warData.warTime = newTime;
                                roomData.save(function () {
                                    this.postMessage('war time synced. ' + Number(mtch[1]) + ' minutes left.');
                                }.bind(this));
                            } else {
                                this.postMessage('not in war.');
                            }
                        }.bind(this));
                    }

                    var newMatchRgx = /^matched\s*(new){0,1}\s*(.*)/;
                    if (newMatchRgx.test(txt)) {

                        var regexmatch = newMatchRgx.exec(txt);
                        // console.log('matched!',regexmatch);
                        if (regexmatch != null) {
                            var guildName = regexmatch[2];
                            if (regexmatch[1] == 'new') {
                               self.enterWarMode(guildName, null, null, false);
                            } else {
                                self.getGuildData(guildName).then(function (data) {
                                    var guild = data.foundGuild;
                                    var bestMatch = data.bestMatch;
                                    var ownData = data.ownData;
                                    //  console.log('-------------->',guild);
                                    if (guild == null && (ownData == null || ownData.__v == undefined)) {
                                        if (bestMatch.guild.guildName) {
                                            var msg = [];
                                            msg.push('can\'t find guild. best match :  (' + bestMatch.guild.guildName + ')');
                                            msg.push('or you can use [matched new GuildName]');
                                            self.postMessage(msg.join('\n'));
                                        }
                                    }
                                    else {
                                        self.enterWarMode(guildName, guild, ownData);
                                    }
                                });
                            }
                        }
                    }

                    if (/^war\sended$/.test(txt) || /^warended$/.test(txt) || /^we$/.test(txt)) {
                        this.getRoomPrefs().then(function (roomData) {
                            if (roomData.warData.inWar) {
                                roomData.warData.inWar = false;
                                roomData.warData.guildName = '';
                                roomData.save();
                                this.postMessage('did we win this one ?');
                            } else {
                                this.postMessage('not in war.');
                            }
                        }.bind(this));
                    }

                    if (/^warstatus$/.test(txt)) {
                        this.getRoomPrefs().then(function (roomData) {
                            //    console.log('war status', roomData);
                            this.postMessage(roomData.warData.inWar ? 'in war with ' + roomData.warData.guildName : 'not in war');
                        }.bind(this));
                    }

                    this.jokesHandler(txt);

                    if (/^myt$/.test(txt) || /^my\stargets$/.test(txt) || /^nut$/.test(txt)) {
                        this.getRoomPrefs().then(function (roomData) {
                            try {
                                if (roomData.warData.inWar) {
                                    var player = roomPrefs.getRoomPlayerFromRoomPref(roomData, msg.user_id);
                                    var risk = player == undefined ? 0 : Number(player.risk);
                                    this.findUserTargets(roomData.warData.guildName, msg.name, risk);

                                } else {
                                    this.postMessage('can\'t look for targets while not in war.');
                                }
                            } catch (e) {
                                console.log('------->', e);
                                console.trace();
                            }
                        }.bind(this));
                    }

                    var settingsRgx = /^[Ss]et\s(\w+)\s(\w+)$/;
                    var validSettings = ['timer'];
                    if (settingsRgx.test(txt)) {
                        var mtches = settingsRgx.exec(txt);

                        var key = mtches[1];
                        var val = mtches[2];
                        if (key == undefined || val == undefined) {
                            return;
                        }
                        if (validSettings.indexOf(key) == -1) {
                            this.postMessage('invalid setting key');
                            return;
                        }
                        this.getRoomPrefs().then(function (roomData) {
                            roomPrefs.setRoomSetting(roomData, key, val);
                            this.postMessage('Room setting ' + key + ' was set to ' + val);
                        }.bind(this));
                    }

                    var getSettingsRgx = /^[Gg]et\s(\w+)$/;
                    if (getSettingsRgx.test(txt)) {
                        var mtches = getSettingsRgx.exec(txt);

                        var key = mtches[1];
                        if (key == undefined) {
                            return;
                        }
                        if (validSettings.indexOf(key) == -1) {
                            this.postMessage('invalid setting key');
                            return;
                        }
                        this.getRoomPrefs().then(function (roomData) {
                            var val = roomPrefs.getRoomSettingFromRoomPref(roomData, key);
                            this.postMessage('Room setting for ' + key + ' is ' + (val == undefined ? 'default value' : val));
                        }.bind(this));
                    }

                    var minitRgx = /^minit(\d)?$/;
                    if (minitRgx.test(txt)) {
                        var mtch = minitRgx.exec(txt);
                        var idx = mtch[1] == undefined ? 1 : Number(mtch[1]);
                        this.getRoomPrefs().then(function (roomData) {
                            try {

                                if (roomData.warData.inWar) {
                                    var p = roomPrefs.getRoomPlayerFromRoomPref(roomData, msg.user_id);
                                    var minis = p == undefined ? [] : p.minis;
                                    var mini = _.find(minis, function (mini) {
                                        return mini.idx == idx;
                                    });
                                    if (p == null || p == undefined || mini == undefined) {
                                        this.postMessage('please set mini data using mymini command.');
                                    } else {
                                        this.findUserTargets(roomData.warData.guildName, mini.player, p.risk);
                                    }

                                } else {
                                    this.postMessage('can\'t look for targets while not in war.');
                                }
                            } catch (e) {
                                console.log('------->', e);
                                console.trace();
                            }
                        }.bind(this));
                    }
                    ;

                    var miniRgx = /^[mM]ymini(\d)?\s(.*)/;
                    if (miniRgx.test(caseSensitiveTxt)) {
                        var match = miniRgx.exec(caseSensitiveTxt);
                        var idx = match[1] == undefined ? 1 : Number(match[1]);
                        var miniP = new Player('199 ' + match[2]);
                        if (miniP.isPlayer()) {
                            //  console.log('adding mini : ' + miniP.toString().substr(4));
                            roomPrefs.addUpdateMini(this.roomId, msg.user_id, idx, miniP.toString().substr(4)).then(function (msg) {
                                this.postMessage(msg);
                            }.bind(this));

                        } else {
                            this.postMessage('can\'t get Mini stats, try something like mymini Name 1m/1k/1k');
                        }
                    }
                    if (/^[mM]ymini$/.test(txt)) {
                        roomPrefs.getRoomPlayer(this.roomId, msg.user_id).then(function (player) {

                            var msg = [];
                            if (player == undefined || player.minis.length == 0) {
                                this.postMessage('you don\'t have any toons set.')
                                return;
                            } else {
                                _.each(player.minis || [], function (mini) {
                                    var p = new Player('199 ' + mini.player);
                                    if (p.isPlayer()) {
                                        msg.push('Mini #' + mini.idx + ': ' + p.toString().substr(4));
                                    }
                                });
                                this.postMessage(msg.join('\n'));
                            }
                        }.bind(this));
                    }
                    var riskRgx = /^[mM]yrisk\s?(\d?\d?)/;
                    if (riskRgx.test(caseSensitiveTxt)) {
                        var match = riskRgx.exec(caseSensitiveTxt);
                        var risk = match[1];
                        if (risk != undefined && risk != '') {
                            risk = Number(risk);
                            if (risk > 10) {
                                risk = 10;
                            }
                            roomPrefs.updatePlayerRisk(self.roomId, msg.user_id, msg.name, risk).then(function (retMsg) {
                                this.postMessage(retMsg);

                            }.bind(this));
                        } else {
                            this.getRoomPrefs().then(function (roomPref) {
                                var player = _.find(roomPref.playersPrefs || [], function (p) {
                                    return p.id == msg.user_id;
                                });
                                this.postMessage('Current risk for ' + msg.name + ' is ' + (player == undefined ? 0 : player.risk));
                            }.bind(this));
                        }
                    }

                    var bulkRgx = /^[bB]ulk\s?\b(on|off)?/;
                    if (bulkRgx.test(caseSensitiveTxt)) {
                        var match = bulkRgx.exec(caseSensitiveTxt);
                        var newMode = match[1];
                        if (!(newMode == '' || newMode == undefined)) {
                            var newBulkMode = (newMode == 'on') ? true : false;
                            ctxPlayer.bulk = newBulkMode;
                            this.updateCtxPlayer(ctxPlayer);
                            this.postMessage('Bulk mode is ' + (ctxPlayer.bulk ? 'on' : 'off') + ' for ' + msg.name);

                        } else {
                            this.postMessage('Bulk mode is ' + (ctxPlayer.bulk ? 'on' : 'off') + ' for ' + msg.name);

                        }
                    }

                    if (/^help$/.test(txt)) {
                        this.showHelp();
                    }

                    var removeRgx = /^[rR][eE][mM][oO][vV][eE]\s*(\d+)\s(.*)/;
                    if (removeRgx.test(caseSensitiveTxt)) {
                        this.getRoomPrefs().then(function (roomData) {
                            if (roomData.warData.inWar) {
                                // console.log('removing user');
                                this.removeUserFromOwnData(roomData.warData.guildName, removeRgx.exec(caseSensitiveTxt)).then(function (msg) {
                                    if (msg != '') {
                                        self.postMessage(msg);
                                    }

                                });
                            } else {
                                this.postMessage('can\'t remove a user while not in war.');
                            }
                        }.bind(this));
                    }

                    // handle insertion
                    var lines = caseSensitiveTxt.split('\n');

                    var maxLines = ctxPlayer.bulk ? 20 : 1;
                    var usersToAdd = [];
                    for (var i = 0; i < maxLines && i < lines.length; i++) {
                        var addUser = new Player(lines[i]);
                        if (addUser.isPlayer()) {
                            usersToAdd.push(addUser);
                        }
                    }
                    if (usersToAdd.length > 0) {
                        this.getRoomPrefs().then(function (roomData) {
                            //  console.log(roomData);
                            if (roomData.warData.inWar) {
                                this.insertOwnData(roomData.warData.guildName, usersToAdd, msg.name, self.roomId, msg.user_id);
                            } else {
                                this.postMessage('Not in war at the moment, cant add users.')

                            }
                        }.bind(this));

                    }

                },
                jokesHandler: function (txt) {
                    if (/^joke$/.test(txt)) {
                        this.tellAJoke();
                        return;
                    }

                    if (/facepalm/.test(txt)) {
                        this.tellGifJoke('marvel-wolverine-facepalm');
                        return;
                    }

                    if (/potato/.test(txt)) {
                        this.tellGifJoke('yellow-minions-potato');
                        return;
                    }

                    if (/gumby/.test(txt)) {
                        this.tellGifJoke('unf-gumby');
                        return;
                    }

                    if (/cowbell/.test(txt)) {
                        this.tellGifJoke('cowbell snl');
                        return;
                    }

                    if (/banana/.test(txt)) {
                        this.tellGifJoke('cw8Nr4u28tVKw');
                        return;
                    }

                    if (/^minions$/.test(txt)) {
                        this.tellGifJoke();
                        return;
                    }

                    var gifRgx = /^gif\s(.*)+$/;
                    if (gifRgx.test(txt)) {
                        var match = gifRgx.exec(txt);
                        this.tellGifJoke(match[1]);
                        return;
                    }


                },
                getCtxPlayer: function (id) {
                    var player = _.find(this.ctx.players, function (p) {
                        return p.id == id;
                    });
                    if (player == undefined) {
                        player = {
                            id: id,
                            bulk: false,
                            lastMsg: '',
                            options: []
                        }
                    }
                    return player;
                },
                updateCtxPlayer: function (p) {
                    var players = _.filter(this.ctx.players, function (el) {
                        return el.id != p.id;
                    });
                    players.push(p);
                    this.ctx.players = players;

                },

                handleCtxPlayer: function (txt, msg) {
                    var ctxPlayer = this.getCtxPlayer(msg.user_id);
                    var hasMatch = false;
                    var lowerCase = txt.toLowerCase();
                    _.each(ctxPlayer.options, function (option) {
                        if (option['key'].test(lowerCase)) {
                            this.mainSwitch(option.cmd, msg);
                            hasMatch = true;
                        }
                    }.bind(this));
                    ctxPlayer.options = [];
                    this.updateCtxPlayer(ctxPlayer);
                    return hasMatch;
                },

                tellAJoke: function () {
                    var self = this;
                    chuckJokes.getJoke().then(function (joke) {
                        self.postMessage(joke);
                    }.bind(this))
                },

                tellGifJoke: function (theme) {
                    var self = this;
                    theme = typeof(theme) == 'string' ? theme : 'minions';
                    //  console.log('gif ', theme);
                    giphy.random(encodeURI(theme), function (err, response) {
                        if (err == null) {
                            self.postMessage('', response.data.image_url);
                        } else {
                            self.postMessage('could not find this theme.');

                        }
                    })
                },

                showHelp: function () {
                    var helpMsg = [];
                    helpMsg.push('command list:');
                    helpMsg.push('hello - greet the bot.');
                    helpMsg.push('targets - current targets.');
                    helpMsg.push('all targets - new+old intel.');
                    helpMsg.push('matched [guildName] - enter war mode.');
                    helpMsg.push('123 user 1m/2k/3k - adds user.');
                    helpMsg.push('remove 123 user name - removes a user from our own DB.');
                    helpMsg.push('warended - ends war mode.');
                    helpMsg.push('myt - user targets during war.');
                    helpMsg.push('minit - mini\'s targets during war.');
                    helpMsg.push('mymini user 1m/2k/3k - set mini for user.');
                    helpMsg.push('time - shows war timer.');
                    helpMsg.push('sync mm - syncs number of minutes left for war');
                    helpMsg.push('myrisk 0-6 - sets user risk for myt & minit');
                    helpMsg.push('manual - gets Raven manual');
                    helpMsg.push('joke - random joke.');
                    helpMsg.push('minions - random minion gif.');
                    helpMsg.push('gif theme - random theme gif.');
                    // helpMsg.push('bulk on/off - enable/disable bulk mode');

                    this.postMessage(helpMsg.join('\n'));
                },
                insertOwnData: function (guildName, playersToAdd, addingUserName, addingUserGuild, addingUserId) {
                    var defered = Q.defer();
                    var self = this;
                    var ctxPlayer = this.getCtxPlayer(addingUserId);
                    ctxPlayer.options = [];
                    guildData.getGuildData(guildName, function (item) {
                        for (var i = 0; i < playersToAdd.length; i++) {
                            var player = playersToAdd[i];
                            var players = _.filter(item.players, function (el) {
                                return !(utils.capitaliseFirstLetter(el.name) == player.name && el.lvl == player.lvl);
                            });
                            var mode = players.length == item.players.length ? 'added' : 'updated';
                            if (mode == 'added') {
                                var similarPlayers = _.filter(item.players, function (el) {
                                    var diff = Math.abs(Number(el.lvl) - Number(player.lvl));
                                    var nameMatch = el.name.toLowerCase() == player.name.toLowerCase();
                                    return nameMatch && diff <= 3;
                                });
                                if (similarPlayers.length > 0) {
                                    var msg = [];
                                    msg.push('Found similar players, reply yes to remove:');
                                    _.each(similarPlayers, function (p) {
                                        msg.push(p.lvl + ' ' + utils.capitaliseFirstLetter(p.name));
                                        ctxPlayer.options.push({
                                            'key': new RegExp('^[Yy]es$'),
                                            'cmd': 'remove ' + p.lvl + ' ' + utils.capitaliseFirstLetter(p.name)
                                        });
                                    });
                                    self.postMessage(msg.join('\n'));
                                }
                            }
                            var gpo = player.getGuildPlayerObj();
                            gpo.insertedByGuild = addingUserGuild;
                            gpo.insertedByUser = addingUserName;
                            players.push(gpo);
                            item.players = players;
                            item.save(function () {
                                defered.resolve();
                            });
                            self.postMessage(mode + ' [' + player.toString() + ']');
                        }
                        this.updateCtxPlayer(ctxPlayer);
                    }.bind(this));

                    return defered.promise;
                },
                removeUserFromOwnData: function (guildName, mtch) {
                    var defered = Q.defer();
                    var lvl = mtch[1];
                    var username = mtch[2];
                    //   console.log('remove', lvl, username);
                    guildData.getGuildData(guildName, function (item) {

                        var guildPlayers = item.players;
                        var playerToRemove = _.find(guildPlayers, function (el) {
                            return (utils.capitaliseFirstLetter(el.name) == utils.capitaliseFirstLetter(username) && el.lvl == lvl);
                        });
                        var players = _.filter(guildPlayers, function (el) {
                            return !(utils.capitaliseFirstLetter(el.name) == utils.capitaliseFirstLetter(username) && el.lvl == lvl);
                        });
                        if (guildPlayers.length == players.length) {
                            defered.resolve("Can\'t find " + lvl + ' ' + username + ' in RavenDB');
                            return;
                        }
                        item.players = players;
                        item.save(function () {
                            defered.resolve('removed ' + lvl + ' ' + username + ' from RavenDB');
                        });
                    }.bind(this));
                    return defered.promise;

                },

                findUserTargets: function (guildName, userName, risk) {

                    var user = new Player('199 ' + userName);
                    if (!user.isPlayer()) {
                        this.postMessage('In order to user the myt command you must change your name in the room to reflect your stats using the following template: Name Atk/Eq Atk/Hero Atk');
                        return;
                    }
                    //console.log('find user targets ...', user.name, risk, user.toString());

                    var riskDef = [
                        {'all': 1.2, 'line1': .65, 'line2': .8, 'line3': .7},
                        {'all': 1.1, 'line1': .6, 'line2': .75, 'line3': .65},
                        {'all': 1, 'line1': .55, 'line2': .7, 'line3': .6},
                        {'all': 0.9, 'line1': .45, 'line2': .65, 'line3': .55},
                        {'all': 0.7, 'line1': .4, 'line2': .6, 'line3': .4},
                        {'all': 0.5, 'line1': .35, 'line2': .5, 'line3': .3},
                        {'all': 0, 'line1': .2, 'line2': .4, 'line3': .2}
                    ];
                    //classic war risks
                    riskDef = [
                        {'all': 1.2, 'line1': .8, 'line2':.3, 'line3':.2},
                        {'all': 1.1, 'line1': .75, 'line2':.3, 'line3': .2},
                        {'all': 1, 'line1': .7, 'line2':.3, 'line3': .2},
                        {'all': 0.9, 'line1': .65, 'line2': .3, 'line3': .2},
                        {'all': 0.7, 'line1': .6, 'line2': .3, 'line3': .2},
                        {'all': 0.5, 'line1': .55, 'line2': .3, 'line3': .2},
                        {'all': 0, 'line1': .5, 'line2': .3, 'line3': .2}
                    ];

                    var riskFactor = riskDef[0];
                    if (riskDef[risk] != undefined) {
                        riskFactor = riskDef[risk];
                    } else {
                        risk = 0;
                    }

                    this.getParsedIntelForGuild(guildName).then(function (combinedGuildData) {
                            try {
                                //  console.log('got parsed intel',guildData);
                                var candidates = [];

                                var dups = {};
                                var noDups = [];
                                _.each(combinedGuildData, function (player) {
                                        var playerKey = player.name + '_' + Math.floor(player.lvl / 10) ;
                                        var equiv = _.find(combinedGuildData, function (p) {
                                            return playerKey == p.name + '_' + Math.floor(p.lvl / 10) && p.origin!=player.origin;
                                        });
                                        if (equiv != undefined) {
                                            dups[playerKey]=dups[playerKey]||[];
                                            dups[playerKey].push(player);
                                        }else{
                                            noDups.push(player);
                                        }
                                    }
                                );
                                _.each(dups,function(dup){
                                   var p1=dup[0];
                                    var p2=dup[1];
                                    if (p1.lvl>p2.lvl || (p1.isFresh()&& !p2.isFresh()) || (p1.lvl==p2.lvl && p1.isFresh() && p2.isFresh() && p1.origin=='R' && p2.origin=='SS')){
                                        noDups.push(p1);
                                    }else{
                                        noDups.push(p2);
                                    }
                                })
                            //    _.each(noDups,function(d){console.log(d.name, d.origin, d.isFresh())});;

                                //get all dups
                                //remove dups
                                //iterate on dups and add best one to collection45qw

                                uniqData = _.uniq(noDups, function (player) {
                                    return player.name + '_' + Math.floor(player.lvl / 10);
                                });

                                _.each(uniqData, function (player) {
                                    if (player.isPlayer() && player.def != 0 && player.eqDef != 0 && player.heroDef != 0) {
                                        var line1 = user.def / player.def;
                                        var line2 = user.eqDef / player.eqDef;
                                        var line3 = user.heroDef / player.heroDef;

                                        var all = (line1 * (7 / 14) + line2 * (5 / 14) + line3 * (2 / 14));
                                        // self.postMessage('player: '+player.name+' '+line1+' '+line2+' '+line3+' '+all);
                                        if (all >= riskFactor.all && line1 >= riskFactor.line1 && line2 >= riskFactor.line2 && line3 >= riskFactor.line3) {
                                            player.rank = all;
                                            candidates.push(player);
                                            // console.log(player.name,all)
                                        } else {
                                            //  console.log(player,all,line1,line2,line3);
                                        }
                                    }
                                });

                                var msg = [];
                                if (candidates.length == 0) {
                                    msg.push('Could not find targets for: ' + user.name);
                                } else {
                                    msg.push('Suggested targets for ' + user.name + ' (Risk:' + risk + ')');

                                }
                                candidates = _.sortBy(candidates, function (player) {
                                    return player.lvl + (player.isFresh() ? 200 : 0) + (player.origin == 'R' ? 100 : 0);
                                }).reverse();
                               // console.log(candidates);
                                candidates = candidates.slice(0, 5);
                                _.each(candidates, function (candidate) {
                                    var crank = candidate.rank;
                                    var rank = crank > 2 ? 'A' : crank > 1.5 ? 'B' : 'C';
                                    msg.push(candidate.toString() + ' [' + candidate.origin + '|' + (candidate.isFresh() ? 'Fresh' : 'Old') + '|' + rank + ']');
                                });

                                this.postMessage(msg.join('\n'));
                             //   console.log(msg);
                            }
                            catch
                                (ee) {
                                console.log('------->', ee);
                                console.trace();

                            }
                        }.bind(this)
                    )
                    ;

                },
                getParsedIntelForGuild: function (guildName) {
                    var defered = Q.defer();
                    sheetsData.getGuildData(guildName, function (ssGuildData) {
                        var players;
                        var playerCls = new Players();
                        players = ssGuildData == null ? [] : playerCls.getPlayers(ssGuildData.lastIntel, ssGuildData.lastIntelCell >= 3);
                        guildData.getGuildData(guildName, function (ourData) {
                            var ourPlayers = playerCls.getPlayerObjFromDBPlayers(ourData.players || []);
                            players = players.concat(ourPlayers);
                            defered.resolve(players);
                        });
                    }.bind(this));
                    return defered.promise;
                }
                ,
                getGuildData: function (guildName) {
                    var defered = Q.defer();
                    var self = this;
                    //console.log('looking for data : ', guildName);
                    sheetsData.getGuildData(guildName).then(function (data) {
                        //   console.log('got data from SS',data);
                        /*{
                         foundGuild:foundGuild,
                         bestMatch:bestMatch
                         }*/
                        guildData.getGuildData(guildName, function (item) {
                            //     console.log('got own data ', item);
                            data.ownData = item;
                            defered.resolve(data);
                        }.bind(this));

                    }.bind(this));
                    return defered.promise;

                }
                ,

                enterWarMode: function (guildName, ssData, ownData) {
                    //   console.log('enter war mode', arguments);
                    this.getRoomPrefs().then(function (roomData) {
                        //  console.log('enter war mode with room data', roomData);
                        try {
                            roomData.warData.inWar = true;
                            roomData.warData.guildName = guildName;
                            roomData.warData.warTime = Date.now();
                            roomData.save();
                            var msg = new Array();
                            msg.push('^^ WAR MODE ON ^^');
                            this.sendGuildTargets(msg, guildName, ssData, ownData, false);
                        }
                        catch (e) {
                            console.log('-------->', e);
                            console.trace();
                        }
                    }.bind(this));

                }
                ,
                sendGuildTargetsUnified: function (guildName) {
                    this.getParsedIntelForGuild(guildName).then(function (ssGuildData) {
                        try {
                            var msg = [];
                            var uniqData = _.uniq(ssGuildData, function (player) {
                                return player.name + '_' + Math.floor(player.lvl / 10);
                            });
                            var candidates = [];
                            _.each(uniqData, function (player) {
                                if (player.isPlayer() && player.def != 0 && player.eqDef != 0 && player.heroDef != 0) {
                                    candidates.push(player);
                                }
                            });
                            candidates = _.sortBy(candidates, function (player) {
                                return player.lvl;
                            }).reverse();
                            // console.log(candidates);

                            _.each(candidates, function (candidate) {
                                var crank = candidate.rank;
                                var rank = crank > 2 ? 'A' : crank > 1.5 ? 'B' : 'C';
                                msg.push(candidate.toString() + ' [' + candidate.origin + '|' + (candidate.isFresh() ? 'Fresh' : 'Old') + ']');
                            });

                            this.postMessage(msg.join('\n'));
                        } catch (e) {
                            console.log(e);
                        }
                    }.bind(this));

                }
                ,
                sendGuildTargets: function (msg, guildName, ssData, ownData, all) {
                    //   console.log('send guild targets',arguments);
                    msg = msg || [];
                    msg.push('Targets in ' + guildName + ' :');
                    var ssGuildData = ssData != null ? (all ? ssData.allIntel : ssData.lastIntel) : '';


                    //  console.log(ownData);
                    if (ownData != null && ownData.players.length != 0) {
                        msg.push('Raven data:');
                        var p = new Players();
                        var ownIntel = p.getPlayersIntelFromOwnData(ownData.players);
                        msg.push(ownIntel);
                    } else {
                        msg.push('\nNo Raven data, Please add data.')
                    }
                    if (ssGuildData != null && ssGuildData.length > 5) {
                        msg.push('\nSS data:');
                        ssGuildData = ssGuildData.replace(/\n\s*\n/g, '\n');
                        msg.push(ssGuildData);
                    } else {
                        msg.push('\nNo SS data.');
                    }

                    this.postMessage(msg.join('\n'));

                }
                ,

                onTimeTick: function (roomData) {

                    var d = new Date();
                    var diff = d - roomData.warData.warTime;
                    var timerSettings = roomPrefs.getRoomSettingFromRoomPref(roomData, 'timer');
                    var diffInSeconds = Math.round(diff / 1000);
                    var diffInMinutes = Math.round(diffInSeconds / 60);
                    if (diffInMinutes >= 60) {
                        roomData.warData.inWar = false;
                        roomData.warData.guildName = '';
                        roomData.save(function (e) {
                            console.log(e);
                        });
                        this.postMessage("War ended. did we win this one ?");
                    } else if ((diffInMinutes % 10 == 0 && diffInMinutes > 0) || diffInMinutes == 55) {
                        if (timerSettings != 'off') {
                            this.postMessage(60 - diffInMinutes + " minutes left.");
                        }
                    }
                }
            }
        }
        ()
    )
    ;

//util.inherits(BotsManager, events.EventEmitter);

module.exports = function (options, idx) {
    var md = new Bot(options, idx);
    return md;
};

const Discord = require("discord.js");
const config = require("./config.json");
var fs = require('fs');
var request = require('request');
const { exit } = require("process");
var projectDir = "/home/pi/Desktop/cryptobot/"
var saveFileName = projectDir + 'storedData.json';
var fail = 0;
var failMsg;


const client = new Discord.Client();
const prefix = "!";
const baseURL = "https://web-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?slug=";

var data;
var saves = {
    guildData: {},
    coinData: {},
};


function writeCallback(err) {
    if (err) throw err;
}

function saveConfig() {
    var jsonData = JSON.stringify(saves);
    var data = fs.writeFile(saveFileName, jsonData, 'utf8', writeCallback);
}

function sleep(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms) });
}

function getCoinInfo(slug, logErrors = false) {
    return new Promise((resolve) => {
        request.get({
            url: baseURL + slug,
            json: true,
            headers: {}
        }, async (err, res, data) => {
            if (err) {
                if (logErrors) console.error(err);
                resolve(-1);
            } else if (res.statusCode != 200 && res.statusCode != 400) {
                if (logErrors) console.error("Error: Non-OK status received: " + res.statusCode);
                resolve(-1);
            } else {
                if (!data.data) {
                    if (logErrors) {
                        console.error("Received status " + res.statusCode + " with the following data: ");
                        console.error(data);
                    }
                    resolve(-2);
                } else {
                    resolve(Object.values(data.data)[0]);
                }
            }
            resolve(-1);
        })
    });
}

function fetchAllCoinInfo() {
    let slugList = [];
    for (coin in saves.coinData) {
        slugList.push(coin);
    }
    return new Promise((resolve) => {
        request.get({
            url: baseURL + slugList.join(','),
            json: true,
            headers: {}
        }, async (err, res, data) => {
            if (err) {
                console.error(err);
                resolve(-1);
            } else if (res.statusCode != 200 && res.statusCode != 400) {
                console.error("Error: Non-OK status received: " + res.statusCode);
                resolve(-1);
            } else {
                if (!data.data) {
                    console.error("Received status " + res.statusCode + " with the following data: ");
                    console.error(data);
                    resolve(-2);
                } else {
                    resolve(Object.values(data.data));
                }
            }
            resolve(-1);
        })
    });
}

function updateStatus() {
    let length = Object.keys(saves.coinData).length;
    if (length == 1)
        client.user.setActivity("1 cryptocurrency", { type: 'WATCHING' });
    else
        client.user.setActivity(length + " cryptocurrencies", { type: 'WATCHING' });
}

async function sendErrors(code) {
    if (code == -1) {
        return (await client.users.fetch(config.DEVELOPER_ID)).send("There was a problem connecting to coinmarketcap's servers. I'll edit this message once I am able to connect again.");
    } else if (code == -2) {
        return (await client.users.fetch(config.DEVELOPER_ID)).send("Info for one or more currencies currently being watched cannot be fetched. I'll keep trying and I will edit this message once I am able to successfully do so.");
    }
}

async function handlePriceCheck() {
    let data = await fetchAllCoinInfo();
    if (data == -1) {
        if (fail > 1) {
            if (!failMsg) {
                failMsg = await sendErrors(-1);
                client.user.setStatus('invisible');
            }
        }
        fail += 1;
    } else {
        if (data == -2) {
            if (fail > 1) {
                if (!failMsg)
                    failMsg = await sendErrors(-2);
            }
            fail += 1;
            return;
        }

        if (failMsg) {
            failMsg.edit(failMsg.content + "\n**Edit: Issue is now resolved!**");
            failMsg = undefined;
            client.user.setStatus('online');
        }

        fail = 0;

        data.forEach(coinData => {
            const slug = coinData.slug;
            const price = coinData.quote.USD.price;
            saves.coinData[slug].watchedBy.forEach(guildID => {
                const difference = price - saves.guildData[guildID].coinConfig[slug].lastPriceNotified;
                const percentageDifference = Math.abs(difference / saves.guildData[guildID].coinConfig[slug].lastPriceNotified) * 100;
                let alertPrice = false;
                if (saves.guildData[guildID].coinConfig[slug].alertThreshold.endsWith('%')) {
                    let percentageThreshold = Number(saves.guildData[guildID].coinConfig[slug].alertThreshold.slice(0, -1));
                    alertPrice = percentageDifference >= percentageThreshold;
                } else {
                    alertPrice = Math.abs(difference) >= Number(saves.guildData[guildID].coinConfig[slug].alertThreshold);
                }

                if (alertPrice) {
                    if (difference < 0) {
                        client.channels.cache.get(saves.guildData[guildID].activeChannel).send(saves.coinData[slug].name + " Price Change Alert: Price is now " + price + " USD, a decrease of " +
                            Math.abs(difference) + " USD (" + percentageDifference.toFixed(1) + "%) since " + saves.guildData[guildID].coinConfig[slug].lastDateNotified.toLocaleTimeString([], { day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric' }));
                    } else {
                        client.channels.cache.get(saves.guildData[guildID].activeChannel).send(saves.coinData[slug].name + " Price Change Alert: Price is now " + price + " USD, an increase of " +
                            difference + " USD (" + percentageDifference.toFixed(1) + "%) since " + saves.guildData[guildID].coinConfig[slug].lastDateNotified.toLocaleTimeString([], { day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric' }));
                    }
                    saves.guildData[guildID].coinConfig[slug].lastPriceNotified = price;
                    saves.guildData[guildID].coinConfig[slug].lastDateNotified = new Date();
                }
            });
            saves.coinData[slug].lastPriceChecked = price;
            saves.coinData[slug].lastDateChecked = new Date();
        });
        saveConfig();
    }

}

//Sometimes (inexplicably) the discord.js module will throw an UnhandledPromiseRejection. Since I have no way of handling this myself, I need to manually crash the program when this happens
process.on('unhandledRejection', async (reason, p) => {
    console.error(reason);
    try {
        (await client.users.fetch(config.DEVELOPER_ID)).send("A problem occurred and I had to terminate. I should be restarting very shortly though. Please refer to the developer log for crash details");
    } catch (err) {
        console.error(err);
        process.exit(-1);
    }
    process.exit(-1);
});

process.on('uncaughtException', async (err, origin) => {
    console.error(err);
    try {
        (await client.users.fetch(config.DEVELOPER_ID)).send("A problem occurred and I had to terminate. I should be restarting very shortly though. Please contact the developer for crash details.");
    } catch (err) {
        console.error(err);
        process.exit(-1);
    }

    process.exit(-1);
});

//Load configuration data
try {
    data = fs.readFileSync(saveFileName);
} catch (err) {
    console.log("Failed to read stored data. Creating new configuration file.");
    saveConfig();
}

try {
    saves = JSON.parse(data);
    for (coin in saves.coinData) {
        saves.coinData[coin].lastDateChecked = new Date(Date.parse(saves.coinData[coin].lastDateChecked));
    }
    for (guild in saves.guildData) {
        for (coin in saves.guildData[guild].coinConfig) {
            saves.guildData[guild].coinConfig[coin].lastDateNotified = new Date(Date.parse(saves.guildData[guild].coinConfig[coin].lastDateNotified));
        }
    }
    console.dir(saves)
} catch (err) {
    console.log("Failed to load configuration. Overwriting with fresh config.");
    console.error(err);
}

function deleteGuild(guildID) {
    for (slug in saves.guildData[guildID].coinConfig) {
        let guildIndex = saves.coinData[slug].watchedBy.indexOf(guildID);
        saves.coinData[slug].watchedBy.splice(guildIndex, 1);
        if (saves.coinData[slug].watchedBy.length == 0)
            delete saves.coinData[slug];
    }
    delete saves.guildData[guildID];
}


function createGuild(guild) {
    saves.guildData[guild.id] = {
        activeChannel: "",
        coinConfig: {}
    };
    //Set a default active channel
    guild.channels.cache.every(channel => {
        const permissions = channel.permissionsFor(client.user);
        if (channel.type == "text" && permissions.has('SEND_MESSAGES') && permissions.has('VIEW_CHANNEL')) {
            saves.guildData[guild.id].activeChannel = channel.id;
        } else {
            return true;
        }
        client.channels.cache.get(saves.guildData[guild.id].activeChannel).send("Thank you for adding me to your server! To get started with a list of commands, type `!help`.\n\n " +
            "I will be sending all of my updates to this channel from now on, " +
            "If you would like to change this, you can go to the channel you would like me to move to and type `!setActiveChannel`.");
        return false;
    });
    //No accessible channels available, leave guild
    if (saves.guildData[guild.id].activeChannel == "") {
        guild.leave();
    }
}



function findNewActiveChannel(guild) {
    saves.guildData[guild.id].activeChannel = "";
    guild.channels.cache.every(channel => {
        const permissions = channel.permissionsFor(client.user);
        if (channel.type == "text" && permissions.has("SEND_MESSAGES") && permissions.has('VIEW_CHANNEL')) {
            saves.guildData[guildID].activeChannel = channel.id;
        } else {
            return true;
        }
        client.channels.cache.get(saves.guildData[guildID].activeChannel).send("The channel I previously sent updates to has either been deleted or is inaccessible by me. " +
            "From now on I will be sending my updates to this channel. " +
            "If you would like to change this, you can go to the channel you would like me to move to and type `!setActiveChannel`.");
        return false;
    });
}

client.on("ready", function () {
    const Guilds = client.guilds.cache;
    //Update database with current guilds
    Guilds.forEach(guild => {
        if (!saves.guildData[guild.id]) {
            createGuild(guild);
        }
    });

    //Update deleted/inaccessible channels/guilds already in the database
    for (guildID in saves.guildData) {
        const currentGuild = client.guilds.cache.get(guildID);
        if (!currentGuild || !currentGuild.available) {
            deleteGuild(guildID);
        } else {
            //Check channels
            const currentChannel = client.channels.cache.get(saves.guildData[guildID].activeChannel);
            if (!currentChannel) {
                findNewActiveChannel(currentGuild);
            } else if (!(currentChannel.permissionsFor(client.user).has('SEND_MESSAGES') && currentChannel.permissionsFor(client.user).has('VIEW_CHANNEL'))) {
                findNewActiveChannel(currentGuild);
            }
            //If there are no accessible channels available, leave guild
            if (saves.guildData[guildID].activeChannel == "") {
                currentGuild.leave();
            }
        }
    }
    saveConfig();
    updateStatus();
});

client.on("guildDelete", function (guild) {
    deleteGuild(guild.id);
    saveConfig();
    updateStatus();
});

client.on("channelDelete", async function (channel) {
    if (channel.id == saves.guildData[channel.guild.id].activeChannel) {
        findNewActiveChannel(channel.guild);
        if (saves.guildData[channel.guild.id].activeChannel == "") {
            channel.guild.leave();
            updateStatus();
        }
        saveConfig();
    }
});

client.on("channelUpdate", async function (oldChannel, newChannel) {
    if (newChannel.id == saves.guildData[newChannel.guild.id].activeChannel) {
        const permissions = newChannel.permissionsFor(client.user);
        if (!(permissions.has('SEND_MESSAGES') && permissions.has('VIEW_CHANNEL'))) {
            findNewActiveChannel(newChannel.guild);
            if (saves.guildData[newChannel.guild.id].activeChannel == "") {
                newChannel.guild.leave();
            }
            saveConfig();
            updateStatus();
        }
    }
});

client.on("guildCreate", async function (guild) {
    createGuild(guild);
    saveConfig();
})

client.on("message", async function (message) {
    if (message.author.bot) return;

    if (message.channel instanceof Discord.GuildChannel) {
        if (!message.channel.permissionsFor(client.user).has('SEND_MESSAGES')) return;
    }
    
    if (message.content.toLowerCase().includes("thank you") || message.content.toLowerCase().includes("thanks")) {
        message.channel.messages.fetch({ limit: 1, before: message.id }).then(messages => {
            if (messages.first().author.id == client.user.id) {
                message.channel.send("you're welcome homie");
            }
        });
    }


    if (!message.content.startsWith(prefix)) return;

    const commandBody = message.content.slice(prefix.length);
    const args = commandBody.split(' ');
    const command = args.shift().toLowerCase();
    let guildID = undefined;
    if (message.guild) guildID = message.guild.id;
    let guildData = saves.guildData[guildID];

    if (command == "help") {
        message.channel.send("Here are a list of commands I support: \n\n" +
            "`!help`: show this help menu\n" +
            "`!setActiveChannel`: Sends all future notifications to the channel that you use this command in.\n" +
            "`!watch <currency-name> (<percentage-change>% | <USD-change>)`: Watch a specified crypto currency and notify the active channel when the price changes by the specified percentage/amount in USD. To specify a percentage threshold, add a percent sign to the end of your number. To specify a USD threshold, just enter the number without any other symbols.\n" +
            "`!remove <currency-name>`: Stops watching a specified cryptocurrency.\n" +
            "`!list`: Lists all cryptocurrencies that are currently being watched, and their price fluctuation thresholds.\n" +
            "`!check <currency-name>`: Checks the price of a specified cryptocurrency in USD.");
    }
    else if (command == "watch") {
        if (!guildData) {
            message.channel.send("I can't send alerts to a DM channel! Please use this command in a server instead.");
            return;
        }
        if (args.length == 0) {
            message.channel.send("Usage: `!watch <currency-name> (<percentage-change>% | <USD-change>)`. \nExample percentage command: `!watch bitcoin 20%` (this watches Bitcoin and sends an alert when the price fluctuates by more than 20%)\n" +
                "Example absolute amount command: `!watch bitcoin 30` (this alerts you when the price of BTC fluctuates by 30 USD)");
            return;
        } else if (args.length < 2) {
            message.channel.send("You need to include a percentage change or currency amount to alert you of. \nExample command: `!watch bitcoin 20%` (this watches Bitcoin and sends an alert when the price fluctuates by more than 20%)\n" +
                "Example absolute amount command: `!watch bitcoin 30` (this alerts you when the price of BTC fluctuates by 30 USD)");
            return;
        }
        let threshold = args[args.length - 1];
        if (!Number(threshold) && (!threshold.endsWith('%') || !Number(threshold.slice(0, -1)))) {
            message.channel.send("\"" + threshold + "\" is not a number or a percentage!\nExample percentage command: `!watch bitcoin 20%` (this watches Bitcoin and sends an alert when the price fluctuates by more than 20%)\n" +
                "Example absolute amount command: `!watch bitcoin 30` (this alerts you when the price of bitcoin fluctuates by 30 USD)");
            return;
        }

        const inputName = args.slice(0, args.length - 1).join(' ');
        const slug = inputName.toLowerCase().replace(/-/g, "").replace(/ /g, "-");
        if (guildData.coinConfig[slug]) {
            let oldThreshold = guildData.coinConfig[slug].alertThreshold;
            let newThreshold = threshold;
            if (!oldThreshold.endsWith('%')) {
                oldThreshold += " USD";
            }
            if (!newThreshold.endsWith('%')) {
                newThreshold += " USD";
            }
            message.channel.send("Now setting alert threshold for " + saves.coinData[slug].name + " (" + saves.coinData[slug].symbol + ") from " + oldThreshold + " to " + newThreshold);
            guildData.coinConfig[slug].alertThreshold = threshold;
            saveConfig();
        } else {
            if (!slug) {
                message.channel.send("I didn't receive a proper name! Please try again.");
                return;
            }
            let coinData = saves.coinData[slug];
            if (!coinData) {
                coinData = await getCoinInfo(slug);
                if (coinData == -1) {
                    message.channel.send("There was a problem connecting to coinmarketcap's servers. Please try again later");
                    console.error(err);
                    return;
                } else if (coinData == -2) {
                    message.channel.send("Couldn't find a coin with the name: " + inputName);
                    return;
                }

                saves.coinData[slug] = {
                    id: coinData.id,
                    name: coinData.name,
                    symbol: coinData.symbol,
                    slug: coinData.slug,
                    lastPriceChecked: coinData.quote.USD.price,
                    lastDateChecked: new Date(),
                    watchedBy: [guildID]
                }
            } else {
                coinData.watchedBy.push(guildID);
            }
            let price = saves.coinData[slug].lastPriceChecked;
            let name = coinData.name;

            guildData.coinConfig[slug] = {
                alertThreshold: threshold,
                lastPriceNotified: price,
                lastDateNotified: new Date(),
            }

            if (!threshold.endsWith('%'))
                threshold += " USD";
            message.channel.send("Now watching " + name + " (" + coinData.symbol + ") for price change of " + threshold);
            updateStatus();
            saveConfig();
        }
	
	if (guildData.activeChannel != message.channel.id)
	    message.channel.send("Warning: this is not my active channel! If you would like to receive alerts in this channel, type `!setActiveChannel`.");

    } else if (command == "remove") {
        if (!guildData) {
            message.channel.send("This command isn't supported in DM channels! Please use this command in a server instead.");
            return;
        }
        if (args.length < 1) {
            message.channel.send("Usage: `!remove <currency-name>`");
            return;
        }
        const inputName = args.join(' ');
        const slug = inputName.toLowerCase().replace(/-/g, "").replace(/ /g, "-");

        if (guildData.coinConfig[slug]) {
            let name = saves.coinData[slug].name;
            let symbol = saves.coinData[slug].symbol;
            let guildIndex = saves.coinData[slug].watchedBy.indexOf(guildID);
            saves.coinData[slug].watchedBy.splice(guildIndex, 1);
            delete guildData.coinConfig[slug];
            if (saves.coinData[slug].watchedBy.length == 0)
                delete saves.coinData[slug];
            message.channel.send("Okay. I'm no longer watching " + name + " (" + symbol + ")");
        } else {
            message.channel.send("I'm currently not watching a coin called " + inputName);
        }
        updateStatus();
        saveConfig();
    }
    else if (command == "setactivechannel") {
        if (!guildData) {
            message.channel.send("This command isn't supported in DM channels! Please use this command in a server instead.");
            return;
        }
        guildData.activeChannel = message.channel.id;
        saveConfig();
        message.channel.send("Okay. From now on I'll only send updates to this channel.");
    }
    else if (command == "debug") {
        if (message.author.id == config.DEVELOPER_ID)
            message.channel.send("```json\n" + JSON.stringify(saves) + "\n```");
        else
            message.channel.send("For privacy reasons, only the developer is permitted to view debug data!");
    }
    else if (command == "check") {
        if (!args[0]) {
            message.channel.send("You need to specify a cryptocurrency first. Example command: `!check bitcoin` checks the current price of Bitcoin in USD");
            return;
        }
m
        const inputName = args.join(' ');
        const slug = inputName.toLowerCase().replace(/-/g, "").replace(/ /g, "-");
        let coinData = undefined;
        if (!saves.coinData[slug]) {
            coinData = await getCoinInfo(slug);
        } else {
            coinData = saves.coinData[slug];
        }
        if (coinData == -1) {
            client.users.fetch(config.DEVELOPER_ID).send("There was a problem connecting to coinmarketcap's servers. Please check the developer log for details.");
        } else {
            if (coinData == -2) {
                message.channel.send("Couldn't find a coin with the name: " + inputName);
                return;
            }
            let price = undefined;
            const name = coinData.name;
            if (coinData.quote) {
                price = coinData.quote.USD.price;
                message.channel.send("The current price of " + name + " (" + coinData.symbol + ") is " + price + " USD");
            } else {
                price = coinData.lastPriceChecked;
                const currentDate = new Date();
                let diff = Math.round((currentDate - coinData.lastDateChecked) / 1000);
                message.channel.send("The current price of " + name + " (" + coinData.symbol + ") is " + price + " USD _(last checked " + diff + " seconds ago)_");
            }

        }
    }
    else if (command == "list") {
        if (!guildData) {
            message.channel.send("I can't watch any cryptocurrencies in DM channels! Please use this command in a server instead.");
            return;
        }
        if (Object.keys(guildData.coinConfig).length == 0) {
            message.channel.send("I am currently not watching any currencies!");
        } else {
            let msgtext = "I am currently watching the following currencies: \n\n";
            for (slug in guildData.coinConfig) {
                let threshold = guildData.coinConfig[slug].alertThreshold;
                if (!threshold.endsWith('%'))
                    threshold += " USD";
                msgtext += saves.coinData[slug].name + " (" + saves.coinData[slug].symbol + ") for a " + threshold + " change\n";
            }
            message.channel.send(msgtext);
        }
    } else {
        return;
    }

});

mainLoop();
async function mainLoop() {
    await client.login(config.BOT_TOKEN);
    while (true) {
        if (Object.keys(saves.coinData).length > 0)
            handlePriceCheck();
        await sleep(60000);
    }
}


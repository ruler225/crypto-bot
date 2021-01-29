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

async function handlePriceCheck() {
    let data = await fetchAllCoinInfo();
    if (data == -1) {
        if (fail > 1) {
            if (!failMsg)
                failMsg = await client.channels.cache.get(saves.activeChannel).send("There was a problem connecting to coinmarketcap's servers. I'll edit this message once I am able to connect again.");
        }
        fail += 1;
    } else {
        if (data == -2) {
            if (fail > 1) {
                if (!failMsg)
                    failMsg = await client.channels.cache.get(saves.activeChannel).send("Info for one or more currencies currently being watched cannot be fetched. I'll keep trying and I will edit this message once I am able to successfully do so.");
            }
            fail += 1;
            return;
        }
        //console.log(data);
        data.forEach(coinData => {
            const slug = coinData.slug;
            const price = coinData.quote.USD.price;
            const difference = price - saves.coinData[slug].lastPriceNotified;
            var percentageDifference = 0;
            let alertPrice = false;
            if (saves.coinData[slug].alertThreshold.endsWith('%')) {
                percentageDifference = Math.abs(difference / saves.coinData[slug].lastPriceNotified) * 100;
                let percentageThresold = Number(saves.coinData[slug].alertThreshold.slice(0, -1));
                alertPrice = percentageDifference >= percentageThresold;
            } else if (Math.abs(difference) >= Number(saves.coinData[slug].alertThreshold)) {
                alertPrice = true;
                percentageDifference = Math.abs(difference / saves.coinData[slug].lastPriceNotified) * 100;
            }

            if (failMsg) {
                failMsg.edit(failMsg.content + "\n**Edit: Issue is now resolved!**");
                failMsg = undefined;
            }

            fail = 0;

            if (alertPrice) {
                if (difference < 0) {
                    client.channels.cache.get(saves.activeChannel).send(saves.coinData[slug].name + " Price Change Alert: Price is now " + price + " USD, a decrease of " +
                        Math.abs(difference) + " USD (" + percentageDifference.toFixed(1) + "%) since " + saves.coinData[slug].lastDateNotified.toLocaleTimeString([], { day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric' }));
                } else {
                    client.channels.cache.get(saves.activeChannel).send(saves.coinData[slug].name + " Price Change Alert: Price is now " + price + " USD, an increase of " +
                        difference + " USD (" + percentageDifference.toFixed(1) + "%) since " + saves.coinData[slug].lastDateNotified.toLocaleTimeString([], { day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric' }));
                }
                saves.coinData[slug].lastPriceNotified = price;
                saves.coinData[slug].lastDateNotified = new Date();
            }

            saves.coinData[slug].lastPriceChecked = price;
            saves.coinData[slug].lastDateChecked = new Date();
        });
        saveConfig();
    }

}

//Sometimes (inexplicably) the discord.js module will throw an UnhandledPromiseRejection. Since I have no way of handling this myself, I need to manually crash the program when this happens
process.on('unhandledRejection', (reason, p) => {
    console.error(reason);
    try {
        client.channels.cache.get(saves.activeChannel).send("A problem occurred and I had to terminate. I should be restarting very shortly though. Please refer to the developer log for crash details");
    } catch (err) {
        console.error(err);
        process.exit(-1);
    }
    process.exit(-1);
});

process.on('uncaughtException', (err, origin) => {
    console.error(err);
    try {
        client.channels.cache.get(saves.activeChannel).send("A problem occurred and I had to terminate. I should be restarting very shortly though. Please contact the developer for crash details.");
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
        saves.coinData[coin].lastDateNotified = new Date(Date.parse(saves.coinData[coin].lastDateNotified));
        saves.coinData[coin].lastDateChecked = new Date(Date.parse(saves.coinData[coin].lastDateChecked));
    }
    console.dir(saves)
} catch (err) {
    console.log("Failed to load configuration. Overwriting with fresh config.");
}

client.on("ready", function () {
    const Guilds = client.guilds.cache;
    //Update database with current guilds
    Guilds.forEach(guild => {
        if (!guildData[guild.id]) {
            guildData[guild.id] = {
                activeChannel = "",
                coinConfig = {}
            };
            //Set a default active channel
            guild.channels.cache.every(channel => {
                if (channel.type == "text") {
                    guildData[guild.id].activeChannel = channel.id;
                } else {
                    return true;
                }
                client.channels.cache.get(guildData[guild.id].activeChannel).send("Thank you for adding me to your server! To get started with a list of commands, type `!help`.\n\n " + 
                    "I will be sending all of my updates to this channel from now on, " +
                   "If you would like to change this, you can go to the channel you would like me to move to and type `!setActiveChannel`.");
                return false;
            });

        console.log("initialized a new guild!");
        }
    });

    //Update deleted/inaccessible channels/guilds already in the database
    for (guildID in saves.guildData) {
        const currentGuild = client.guilds.cache.get(guildID);
        if (!currentGuild) {
            delete saves.guildData[guildID];
        } else if (!currentGuild.available) {
            delete saves.guildData[guildID];
        } else {
            //Check channels
            const currentChannel = client.channels.cache.get(guildData[guildID].activeChannel);
            if (!currentChannel) {
                currentGuild.channels.cache.every(channel => {
                    if (channel.type == "text") {
                        guildData[guildID].activeChannel = channel.id;
                    } else {
                        return true;
                    }
                    client.channels.cache.get(guildData[guildID].activeChannel).send("The channel I previously sent updates to has either been deleted or is inaccessible by me. " + 
                        "From now on I will be sending my updates to this channel. " +
                       "If you would like to change this, you can go to the channel you would like me to move to and type `!setActiveChannel`.");
                    return false;
                });
            }

        }
    }
    saveConfig();
    updateStatus();
});

client.on("message", async function (message) {
    if (message.author.bot) return;


    if (message.content.toLowerCase().includes("thank you") || message.content.toLowerCase().includes("thanks")) {
        message.channel.messages.fetch({ limit: 1, before: message.id }).then(messages => {
            if (messages.first().author.id == client.user.id) {
                message.channel.send("you're welcome homie");
            }
        });
    }

    const guildID = message.guild.id;

    if (!message.content.startsWith(prefix)) return;

    const commandBody = message.content.slice(prefix.length);
    const args = commandBody.split(' ');
    const command = args.shift().toLowerCase();

    if (command == "hello") {
        message.reply("Hello there good sir!");
    }
    else if (command == "channel") {
        message.channel.send(message.channel.id);
    }
    else if (command == "help") {
        message.channel.send("Here are a list of commands I support: \n\n" +
            "`!help`: show this help menu\n" +
            "`!setActiveChannel`: Sends all future notifications to the channel that you use this command in.\n" +
            "`!watch <currency-name> (<percentage-change>% | <USD-change>)`: Watch a specified crypto currency and notify the active channel when the price changes by the specified percentage/amount in USD. To specify a percentage threshold, add a percent sign to the end of your number. To specify a USD threshold, just enter the number without any other symbols.\n" +
            "`!remove <currency-name>`: Stops watching a specified cryptocurrency.\n" +
            "`!list`: Lists all cryptocurrencies that are currently being watched, and their price fluctuation thresholds.\n" +
            "`!check <currency-name>`: Checks the price of a specified cryptocurrency in USD.");
    }
    else if (command == "watch") {
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
        if (!Number(threshold) && !threshold.endsWith('%')) {
            message.channel.send("\"" + threshold + "\" is not a number or a percentage!\nExample percentage command: `!watch bitcoin 20%` (this watches Bitcoin and sends an alert when the price fluctuates by more than 20%)\n" +
                "Example absolute amount command: `!watch bitcoin 30` (this alerts you when the price of bitcoin fluctuates by 30 USD)");
            return;
        }

        const inputName = args.slice(0, args.length - 1).join(' ');
        const slug = inputName.toLowerCase().replace(/-/g, "").replace(/ /g, "-"); //TODO: make sure this is immune to trailing/leading spaces
        if (saves.coinData[slug]) {
            let oldThreshold = saves.coinData[slug].alertThreshold;
            let newThreshold = threshold;
            if (!oldThreshold.endsWith('%')) {
                oldThreshold += " USD";
            }
            if (!newThreshold.endsWith('%')) {
                newThreshold += " USD";
            }
            message.channel.send("Now setting alert threshold for " + saves.coinData[slug].name + " (" + saves.coinData[slug].symbol + ") from " + oldThreshold + " to " + newThreshold);
            saves.coinData[slug].alertThreshold = threshold;
            saveConfig();
        } else {
            if (!slug) {
                message.channel.send("I didn't receive a proper name! Please try again.");
                return;
            }
            let coinData = await getCoinInfo(slug);
            if (coinData == -1) {
                client.channels.cache.get(saves.activeChannel).send("There was a problem connecting to coinmarketcap's servers. Please see developer log for details.");
                console.error(err);
            } else {
                if (coinData == -2) {
                    message.channel.send("Couldn't find a coin with the name: " + inputName);
                    return;
                }
                const price = coinData.quote.USD.price;
                const name = coinData.name;
                //TODO: test message preservation across process instances
                saves.coinData[slug] = {
                    id: coinData.id,
                    name: coinData.name,
                    symbol: coinData.symbol,
                    slug: coinData.slug,
                    alertThreshold: threshold,
                    lastPriceNotified: price,
                    lastPriceChecked: price,
                    lastDateNotified: new Date(),
                    lastDateChecked: new Date(),
                }
                if (!threshold.endsWith('%'))
                    threshold += " USD";
                message.channel.send("Now watching " + name + " (" + coinData.symbol + ") for price change of " + threshold);
                updateStatus();
                saveConfig();
            }
        }
    }
    else if (command == "remove") {
        if (args.length < 1) {
            message.channel.send("Usage: `!remove <currency-name>`");
            return;
        }
        const inputName = args.join(' ');
        const slug = inputName.toLowerCase().replace(/-/g, "").replace(/ /g, "-"); //TODO: make sure this is immune to trailing/leading spaces

        if (saves.coinData[slug]) {
            let name = saves.coinData[slug].name;
	    let symbol = saves.coinData[slug].symbol;
            delete saves.coinData[slug];
            updateStatus();
            message.channel.send("Okay. I'm no longer watching " + name + " (" + symbol + ")");
        } else {
            message.channel.send("I'm currently not watching a coin called " + inputName);
        }
        saveConfig();
    }
    else if (command == "setactivechannel") {
        saves.activeChannel = message.channel.id;
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

        const inputName = args.join(' ');
        const slug = inputName.toLowerCase().replace(/-/g, "").replace(/ /g, "-");
        let coinData = undefined;
        if (!saves.coinData[slug]) {
            coinData = await getCoinInfo(slug);
        } else {
            coinData = saves.coinData[slug];
        }
        if (coinData == -1) {
            client.channels.cache.get(saves.activeChannel).send("There was a problem connecting to coinmarketcap's servers. Please check the developer log for details.");
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
        if (Object.keys(saves.coinData).length == 0) {
            message.channel.send("I am currently not watching any currencies!");
        } else {
            var msgtext = "I am currently watching the following currencies: \n\n";
            for (slug in saves.coinData) {
                let threshold = saves.coinData[slug].alertThreshold;
                if (!threshold.endsWith('%'))
                    threshold += " USD";
                msgtext += saves.coinData[slug].name + " (" + saves.coinData[slug].symbol + ") for a " + threshold + " change\n";
            }
            message.channel.send(msgtext);
        }
    } else {
        return;
    }
    if (message.channel.id != saves.activeChannel) {
        message.channel.send("Warning: this is not my active channel! If you would like to receive future updates in this channel, type `!setActiveChannel`.");
    }
});

mainLoop();
async function mainLoop() {
    await client.login(config.BOT_TOKEN);
    while (true) {
        handlePriceCheck();
        await sleep(60000);

    }
}


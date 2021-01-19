const Discord = require("discord.js");
const config = require("./config.json");
var fs = require('fs');
var request = require('request');
const { exit } = require("process");
var projectDir = "/home/pi/Desktop/cryptobot/"
var saveFileName = projectDir + 'storedData.json';
var ready = false;
var fail = 0;
var failMsg;
var coinFail = [];
var coinFailMsg = [];


const client = new Discord.Client();
client.login(config.BOT_TOKEN);
const prefix = "!";
const baseURL = "https://web-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?slug=";

var data;
var saves = {
    lastChannelId: "",
    coinData: {},
};


function writeCallback(err) {
    if (err) throw err;
    //console.log("Wrote data to configuration file.");
}

function saveConfig() {
    //Create copy of existing data and strip any error info
    var saveObj = JSON.parse(JSON.stringify(saves));
    for (coin in saveObj.coinData) {
        delete saveObj.coinData[coin].failStatus;
        delete saveObj.coinData[coin].failMsg;
    }
    var jsonData = JSON.stringify(saveObj);
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
                    //console.log(Object.values(data.data));
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
                failMsg = await client.channels.cache.get(saves.lastChannelId).send("There was a problem connecting to coinmarketcap's servers. I'll edit this message once I am able to connect again.");
        }
        fail += 1;
    } else {
        if (data == -2) {
            if (fail > 1) {
                if (!failMsg)
                    failMsg = await client.channels.cache.get(saves.lastChannelId).send("Info for one or more currencies currently being watched cannot be fetched. I'll keep trying and I will edit this message once I am able to successfully do so.");
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

            if (saves.coinData[slug].failMsg) {
                let msg = saves.coinData[slug].failMsg;
                msg.edit(msg.content + "\n**Edit: Issue is now resolved!**");
                saves.coinData[slug].failMsg = undefined;
            }

            saves.coinData[slug].failStatus = 0;

            if (alertPrice) {
                if (difference < 0) {
                    client.channels.cache.get(saves.lastChannelId).send(saves.coinData[slug].name + " Price Change Alert: Price is now " + price + " USD, a decrease of " +
                        Math.abs(difference) + " USD (" + percentageDifference.toFixed(1) + "%) since " + saves.coinData[slug].lastDateNotified.toLocaleTimeString([], { day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric' }));
                } else {
                    client.channels.cache.get(saves.lastChannelId).send(saves.coinData[slug].name + " Price Change Alert: Price is now " + price + " USD, an increase of " +
                        difference + " USD (" + percentageDifference.toFixed(1) + "%) since " + saves.coinData[slug].lastDateNotified.toLocaleTimeString([], { day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric' }));
                }
                saves.coinData[slug].lastPriceNotified = price;
                saves.coinData[slug].lastDateNotified = new Date();
            }

            saves.coinData[slug].lastPriceChecked = price;
        });
        saveConfig();
    }

}

//Sometimes (inexplicably) the discord.js module will throw an UnhandledPromiseRejection. Since I have no way of handling this myself, I need to manually crash the program when this happens
process.on('unhandledRejection', (reason, p) => {
    console.error(reason);
    if (ready) {
        try {
            client.channels.cache.get(saves.lastChannelId).send("A problem occurred and I had to terminate. I should be restarting very shortly though. Please refer to the developer log for crash details");
        } catch (err) {
            console.error(err);
            process.exit(-1);
        }
    }
    process.exit(-1);
});

process.on('uncaughtException', (err, origin) => {
    console.error(err);
    if (ready) {
        try {
            client.channels.cache.get(saves.lastChannelId).send("A problem occurred and I had to terminate. I should be restarting very shortly though. Please contact the developer for crash details.");
        } catch (err) {
            console.error(err);
            process.exit(-1);
        }
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
        saves.coinData[coin].failStatus = 0;    //Initialize fail data
        saves.coinData[coin].lastDateNotified = new Date(Date.parse(saves.coinData[coin].lastDateNotified));
    }
    console.dir(saves)
} catch (err) {
    console.log("Failed to load configuration. Overwriting with fresh config.");
}

client.on("ready", function () {
    if (saves.lastChannelId == "") {
        const Guilds = client.guilds.cache;
        Guilds.forEach(guild => {
            //console.log(guild);
            guild.channels.cache.every(channel => {
                if (channel.type == "text") {
                    saves.lastChannelId = channel.id;
                } else {
                    return true;
                }
                //client.channels.cache.get(saves.lastChannelId).send("Hello! I'm now up and running! I will be sending all of my updates to this channel from now on. " +
                //   "If you would like to change this, you can go to the channel you would like me to move to and type `!setActiveChannel`. " +
                //   "For a list of commands, type `!help`.");
                return false;
            });
        });
    }
    ready = true;
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
            message.channel.send("Now setting alert threshold for " + saves.coinData[slug].name + " from " + oldThreshold + " to " + newThreshold);
            saves.coinData[slug].alertThreshold = threshold;
            saveConfig();
        } else {
            if (!slug) {
                message.channel.send("I didn't receive a proper name! Please try again.");
                return;
            }
            let coinData = await getCoinInfo(slug);
            if (coinData == -1) {
                client.channels.cache.get(saves.lastChannelId).send("There was a problem connecting to coinmarketcap's servers. Please see developer log for details.");
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
                    failStatus: 0,
                }
                if (!threshold.endsWith('%'))
                    threshold += " USD";
                message.channel.send("Now watching " + name + " for price change of " + threshold);
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
            delete saves.coinData[slug];
            updateStatus();
            message.channel.send("Okay. I'm no longer watching " + name);
        } else {
            message.channel.send("I'm currently not watching a coin called " + inputName);
        }
        saveConfig();
    }
    else if (command == "setactivechannel") {
        saves.lastChannelId = message.channel.id;
        saveConfig();
        message.channel.send("Okay. From now on I'll only send updates to this channel.");
    }
    else if (command == "debug") {
        message.channel.send(JSON.stringify(saves));
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
            client.channels.cache.get(saves.lastChannelId).send("There was a problem connecting to coinmarketcap's servers. Please check the developer log for details.");
        } else {
            if (coinData == -2) {
                message.channel.send("Couldn't find a coin with the name: " + inputName);
                return;
            }
            let price = undefined;
            if (coinData.quote) price = coinData.quote.USD.price;
            else price = coinData.lastPriceChecked;
            const name = coinData.name;
            message.channel.send("The current price of " + name + " is " + price + " USD");
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
                msgtext += saves.coinData[slug].name + " for a " + threshold + " change\n";
            }
            message.channel.send(msgtext);
        }
    } else {
        return;
    }
    if (message.channel.id != saves.lastChannelId) {
        message.channel.send("Warning: this is not my active channel! If you would like to receive future updates in this channel, type `!setActiveChannel`.");
    }
});

mainLoop();
async function mainLoop() {
    await sleep(5000);
    while (true) {
        handlePriceCheck();
        await sleep(60000);

    }
}


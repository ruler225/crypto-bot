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
    coinSlugs: [],
    alertThresholds: [],
    lastPriceNotified: [],
    lastDateNotified: [],
    coinNames: []
};


function writeCallback(err) {
    if (err) throw err;
    //console.log("Wrote data to configuration file.");
}

function saveConfig() {
    var jsonData = JSON.stringify(saves);
    var data = fs.writeFile(saveFileName, jsonData, 'utf8', writeCallback);
}

function sleep(ms) {
    return new Promise((resolve) => {setTimeout(resolve, ms)});
}

function getCoinInfo(slug) {
    return new Promise((resolve) => {request.get({url: baseURL + slug,
        json: true,
        headers: {}}, async (err, res, data) => {
            if (err) {
                console.error(err);
                resolve(-1);
        } else if (res.statusCode != 200 && res.statusCode != 400) {
            console.error("Error: Non-OK status received: " + res.statusCode);
            resolve(-1);
        } else {
            if (!data.data) {
                resolve(-2);
            } else {
                resolve(Object.values(data.data)[0]);
            }
        }
        resolve(-1);
    })});
}

async function handlePriceCheck(slug) {
    coinData = await getCoinInfo(slug);
    coinIndex = saves.coinSlugs.indexOf(slug);
        if (coinData == -1) {
            if (fail > 1) {
                if (!failMsg)
                    failMsg = await client.channels.cache.get(saves.lastChannelId).send("There was a problem connecting to coinmarketcap's servers. I'll edit this message once I am able to connect again.");
		}
                fail += 1;
        } else {
            if (coinData == -2) {
		        if (coinFail[coinIndex] > 1) {
                    		if (!coinFailMsg[coinIndex])
					coinFailMsg[coinIndex] = await client.channels.cache.get(saves.lastChannelId).send("I was unable to fetch price info for " + saves.coinNames[coinIndex] + ". I'll keep trying and I will edit this message once I am able to successfully do so.");
			}
		        coinFail[coinIndex] += 1;
                return;
            }
            const price = coinData.quote.USD.price;
            const difference = price - saves.lastPriceNotified[coinIndex];
            var percentageDifference = 0;
            let alertPrice = false;
            if (saves.alertThresholds[coinIndex].endsWith('%')) {
                percentageDifference = Math.abs(difference/saves.lastPriceNotified[coinIndex])*100;
                let percentageThresold = Number(saves.alertThresholds[coinIndex].slice(0, -1));
                alertPrice = percentageDifference >= percentageThresold;
            } else if (Math.abs(difference) >= Number(saves.alertThresholds[coinIndex])) {
                alertPrice = true;
                percentageDifference = Math.abs(difference/saves.lastPriceNotified[coinIndex])*100;
            }

	    if (failMsg) {
	    	failMsg.edit(failMsg.content + "\n**Edit: Issue is now resolved!**");
		    failMsg = undefined;
	    }
        
        fail = 0;

	    if (coinFailMsg[coinIndex]) {
	    	coinFailMsg[coinIndex].edit(coinFailMsg[coinIndex].content + "\n**Edit: Issue is now resolved!**");
		coinFailMsg[coinIndex] = undefined;
	    }
	
   	    coinFail[coinIndex] = 0;

            if (alertPrice) {
                if (difference < 0 ) {
                    client.channels.cache.get(saves.lastChannelId).send(saves.coinNames[coinIndex] + " PRICE CHANGE ALERT: Price is now " + price + " USD, a decrease of " +
                        Math.abs(difference) + " USD (" + percentageDifference.toFixed(1) + "%) since " + saves.lastDateNotified[coinIndex].toLocaleTimeString([], {day:'numeric', month:'numeric',year:'numeric', hour:'numeric', minute:'numeric'}));
                } else {
                    client.channels.cache.get(saves.lastChannelId).send(saves.coinNames[coinIndex] + " PRICE CHANGE ALERT: Price is now " + price + " USD, an increase of " +
                        difference + " USD (" + percentageDifference.toFixed(1) + "%) since " + saves.lastDateNotified[coinIndex].toLocaleTimeString([], {day:'numeric', month:'numeric',year:'numeric', hour:'numeric', minute:'numeric'}));
                }
                saves.lastPriceNotified[coinIndex] = price;
                saves.lastDateNotified[coinIndex] = new Date();
		        saveConfig();
            }
            
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
    for (var i = 0; i < saves.lastDateNotified.length; i++) {
        saves.lastDateNotified[i] = new Date(Date.parse(saves.lastDateNotified[i]));
    }
    console.dir(saves)
} catch (err) {
    //console.log("Failed to load configuration");
    console.error(err);
}

//Initialize fail data
coinFail = Array(saves.coinSlugs.length).fill(0);
coinFailMsg = Array(saves.coinSlugs.length).fill(undefined);

client.on("ready", function() {
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
    if (saves.coinSlugs.length == 1)
        client.user.setActivity(saves.coinSlugs.length + " cryptocurrency", {type: 'WATCHING'});
    else
        client.user.setActivity(saves.coinSlugs.length + " cryptocurrencies", {type: 'WATCHING'});
});

client.on("message", async function(message) {
if (message.author.bot) return;


if (message.content.toLowerCase().includes("thank you") || message.content.toLowerCase().includes("thanks")) {
	message.channel.messages.fetch({limit : 1, before : message.id}).then( messages => {
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
        "`!watch <currency-name> (<percentage-change>% | <USD-change>)`: Watch a specified crypto currency and notify the active channel when the price changes by the specified percentage/amount in USD. To specify a percentage threshold, add a percent sign to the end of your number. To specify a USD threshold, just enter the number without any other slugs.\n" +
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
    const coinIndex = saves.coinSlugs.indexOf(slug);
    if (coinIndex != -1 ) {
        let oldThreshold = saves.alertThresholds[coinIndex];
        let newThreshold = threshold;
        if (!oldThreshold.endsWith('%')) {
            oldThreshold += " USD";
        }
        if (!newThreshold.endsWith('%')) {
            newThreshold += " USD";
        }
        message.channel.send("Now setting alert threshold for " + saves.coinNames[coinIndex] + " from " + oldThreshold + " to " + newThreshold);
        saves.alertThresholds[coinIndex] = threshold;
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
            saves.coinSlugs.push(slug);
            saves.alertThresholds.push(threshold);
            saves.lastPriceNotified.push(price);
            saves.lastDateNotified.push(new Date());
            saves.coinNames.push(name);
            coinFail.push(0);
            coinFailMsg.push(undefined);
            if (!threshold.endsWith('%')) 
                threshold += " USD";
            message.channel.send("Now watching " + name + " for price change of " + threshold);
            if (saves.coinSlugs.length == 1)
                client.user.setActivity(saves.coinSlugs.length + " cryptocurrency", {type: 'WATCHING'});
            else
                client.user.setActivity(saves.coinSlugs.length + " cryptocurrencies", {type: 'WATCHING'});

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


    const coinIndex = saves.coinSlugs.indexOf(slug);
    const name = saves.coinNames[coinIndex];
    if (coinIndex != -1) {
        saves.coinSlugs.splice(coinIndex, 1);
        saves.alertThresholds.splice(coinIndex, 1);
        saves.lastPriceNotified.splice(coinIndex, 1);
        saves.lastDateNotified.splice(coinIndex, 1);
        saves.coinNames.splice(coinIndex, 1);
        coinFail.splice(coinIndex, 1);
        coinFailMsg.splice(coinIndex, 1);
        if (saves.coinSlugs.length == 1)
            client.user.setActivity(saves.coinSlugs.length + " cryptocurrency", {type: 'WATCHING'});
        else
            client.user.setActivity(saves.coinSlugs.length + " cryptocurrencies", {type: 'WATCHING'});
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
    const slug = inputName.toLowerCase().replace(/-/g, "").replace(/ /g, "-"); //TODO: make sure this is immune to trailing/leading spaces
    let coinData = await getCoinInfo(slug);
    if (coinData == -1) {
        client.channels.cache.get(saves.lastChannelId).send("There was a problem connecting to coinmarketcap's servers. Please check the developer log for details.");
    } else {
        if (coinData == -2) {
            message.channel.send("Couldn't find a coin with the name: " + inputName);
            return;
        }
        const price = coinData.quote.USD.price;
        const name = coinData.name;
        message.channel.send("The current price of " + name + " is " + price + " USD");
    } 
}
else if (command == "list") {
    if (saves.coinSlugs.length == 0) {
        message.channel.send("I am currently not watching any currencies!");
    } else {
        var msgtext = "I am currently watching the following currencies: \n\n";
        for (var i = 0; i < saves.coinSlugs.length; i++) {
            let threshold = saves.alertThresholds[i];
            if (!threshold.endsWith('%'))
                threshold += " USD";
            msgtext += saves.coinNames[i] + " for a " + threshold + " change\n";
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
        for (var i = 0; i < saves.coinSlugs.length && ready; i++) {
            const slug = saves.coinSlugs[i];
            handlePriceCheck(slug);
        }
        await sleep(60000);
        
    }
}


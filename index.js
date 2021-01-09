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
const baseURL = "https://web-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=";

var data;
var saves = {
    lastChannelId: "",
    coinSymbols: [],
    alertThresholds: [],
    lastPriceNotified: [],
    lastDateNotified: []
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

function getCoinInfo(symbol) {
    return new Promise((resolve) => {request.get({url: baseURL + symbol,
        json: true,
        headers: {}}, async (err, res, data) => {
            if (err) {
                console.error(err);
                resolve(-1);
        } else if (res.statusCode != 200) {
            console.error("Error: Non-OK status received: " + res.statusCode);
            resolve(-1);
        } else {
            if (!data.data[symbol]) {
                resolve(-2);
            } else {
                resolve(data.data[symbol]);
            }
        }
        resolve(-1);
    })});
}

async function handlePriceCheck(symbol) {
    coinData = await getCoinInfo(symbol);
    coinIndex = saves.coinSymbols.indexOf(symbol);
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
					coinFailMsg[coinIndex] = await client.channels.cache.get(saves.lastChannelId).send("I was unable to fetch price info for " + symbol + ". I'll keep trying and I will edit this message once I am able to successfully do so.");
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
                    client.channels.cache.get(saves.lastChannelId).send(symbol + " PRICE CHANGE ALERT: Price is now " + price + " USD, a decrease of " +
                        Math.abs(difference) + " USD (" + percentageDifference.toFixed(1) + "%) since " + saves.lastDateNotified[coinIndex].toLocaleString("en-US"));
                } else {
                    client.channels.cache.get(saves.lastChannelId).send(symbol + " PRICE CHANGE ALERT: Price is now " + price + " USD, an increase of " +
                        difference + " USD (" + percentageDifference.toFixed(1) + "%) since " + saves.lastDateNotified[coinIndex].toLocaleString("en-US"));
                }
                saves.lastPriceNotified[coinIndex] = price;
                saves.lastDateNotified[coinIndex] = new Date();
		        saveConfig();
            }
            
        }
    
}

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
coinFail = Array(saves.coinSymbols.length).fill(0);
coinFailMsg = Array(saves.coinSymbols.length).fill(undefined);

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
                //    "If you would like to change this, you can go to the channel you would like me to move to and type `!setActiveChannel`. " +
                //    "For a list of commands, type `!help`.");
                return false;
            });
    });
    }
    ready = true;
    client.user.setActivity(saves.coinSymbols.length + " cryptocurrencies", {type: 'WATCHING'});
});

client.on("message", async function(message) {
if (message.content.toLowerCase().includes("thank you") || message.content.toLowerCase().includes("thanks")) {
	message.channel.messages.fetch({limit : 1, before : message.id}).then( messages => {
		if (messages.first().author.id == client.user.id) {
			message.channel.send("you're welcome homie");
		}
	});
}

if (message.author.bot || !message.content.startsWith(prefix)) return;

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
        "`!watch <crypto-symbol> (<percentage-change>% | <USD-change>)`: Watch a specified crypto currency and notify the active channel when the price changes by the specified percentage/amount in USD. To specify a percentage threshold, add a percent sign to the end of your number. To specify a USD threshold, just enter the number without any other symbols.\n" +
        "`!remove <crypto-symbol>`: Stops watching a specified cryptocurrency.\n" + 
        "`!list`: Lists all cryptocurrencies that are currently being watched, and their price fluctuation thresholds.\n" + 
        "`!check <crypto-symbol>`: Checks the price of a specified cryptocurrency in USD.");
}
else if (command == "watch") {
    if (args.length == 0) {
        message.channel.send("Usage: `!watch <symbol> (<percentage-change>% | <USD-change>)`. \nExample percentage command: `!watch BTC 20%` (this watches Bitcoin and sends an alert when the price fluctuates by more than 20%)\n" + 
            "Example absolute amount command: `!watch BTC 30` (this alerts you when the price of BTC fluctuates by 30 USD)");
        return;
    } else if (args.length < 2) {
        message.channel.send("You need to include a percentage change or currency amount to alert you of. \nExample command: `!watch BTC 20%` (this watches Bitcoin and sends an alert when the price fluctuates by more than 20%)\n" + 
            "Example absolute amount command: `!watch BTC 30` (this alerts you when the price of BTC fluctuates by 30 USD)");
        return;
    }
    if (!Number(args[1]) &&  !args[1].endsWith('%')) {
        message.channel.send("\"" + args[1] + "\" is not a number or a percentage!\nExample percentage command: `!watch BTC 20%` (this watches Bitcoin and sends an alert when the price fluctuates by more than 20%)\n" +
            "Example absolute amount command: `!watch BTC 30` (this alerts you when the price of BTC fluctuates by 30 USD)");
        return;
    }

    const symbol = args[0].toUpperCase();
    const coinIndex = saves.coinSymbols.indexOf(symbol);
    if (coinIndex != -1 ) {
        let oldThreshold = saves.alertThresholds[coinIndex];
        let newThreshold = args[1];
        if (!oldThreshold.endsWith('%')) {
            oldThreshold += " USD";
        }
        if (!newThreshold.endsWith('%')) {
            newThreshold += " USD";
        }
        message.channel.send("Now setting alert threshold for " + symbol + " from " + oldThreshold + " to " + newThreshold);
        saves.alertThresholds[coinIndex] = args[1];
        saveConfig();
    } else {
        let threshold = args[1];
        if (!symbol) {
            message.channel.send("I didn't receive a proper symbol! Please try again.");
            return;
        }
        let coinData = await getCoinInfo(symbol);
        if (coinData == -1) {
            client.channels.cache.get(saves.lastChannelId).send("There was a problem connecting to coinmarketcap's servers. Please see developer log for details.");
            console.error(err);
        } else {
            if (coinData == -2) {
                message.channel.send("Couldn't find a coin with the symbol: " + symbol);
                return;
            }
            const price = coinData.quote.USD.price;
            const name = coinData.name;
            saves.coinSymbols.push(symbol);
            saves.alertThresholds.push(args[1]);
            saves.lastPriceNotified.push(price);
            saves.lastDateNotified.push(new Date());
            if (!threshold.endsWith('%')) 
                threshold += " USD";
            message.channel.send("Now watching " + name + " (" + args[0].toUpperCase() + ") for price change of " + threshold);
            client.user.setActivity(saves.coinSymbols.length + " cryptocurrencies", {type: 'WATCHING'});
		    saveConfig();
        }
    }
}
else if (command == "remove") {
    if (args.length != 1) {
        message.channel.send("Usage: `!remove <symbol>`");
        return;
    }
    const coinIndex = saves.coinSymbols.indexOf(args[0].toUpperCase());
    if (coinIndex != -1) {
        saves.coinSymbols.splice(coinIndex, 1);
        saves.alertThresholds.splice(coinIndex, 1);
        saves.lastPriceNotified.splice(coinIndex, 1);
        saves.lastDateNotified.splice(coinIndex, 1);
	client.user.setActivity(saves.coinSymbols.length + " cryptocurrencies", {type: 'WATCHING'});
        message.channel.send("Okay. I'm no longer watching " + args[0].toUpperCase());
    } else {
        message.channel.send("I'm currently not watching a coin called " + args[0].toUpperCase() );
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
    	message.channel.send("You need to specify a symbol first. Example command: `!check BTC` checks the current price of Bitcoin in USD");
	    return;
    }
    const symbol = args[0].toUpperCase();
    let coinData = await getCoinInfo(symbol);
    if (coinData == -1) {
        client.channels.cache.get(saves.lastChannelId).send("There was a problem connecting to coinmarketcap's servers. Please check the developer log for details.");
        console.error(err);
    } else {
        if (coinData == -2) {
            message.channel.send("Couldn't find a coin with the symbol: " + symbol);
            return;
        }
        const price = coinData.quote.USD.price;
        const name = coinData.name;
        message.channel.send("The current price of " + name + " (" + symbol + ") is " + price + " USD");
    } 
}
else if (command == "list") {
    if (saves.coinSymbols.length == 0) {
        message.channel.send("I am currently not watching any currencies!");
    } else {
        var msgtext = "I am currently watching the following currencies: \n\n";
        for (var i = 0; i < saves.coinSymbols.length; i++) {
            let threshold = saves.alertThresholds[i];
            if (!threshold.endsWith('%'))
                threshold += " USD";
            msgtext += saves.coinSymbols[i] + " for a " + threshold + " change\n";
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
    while (true) {
        for (var i = 0; i < saves.coinSymbols.length && ready; i++) {
            const symbol = saves.coinSymbols[i];
            handlePriceCheck(symbol);
        }
        await sleep(60000);
        
    }
}


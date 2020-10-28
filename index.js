const Discord = require("discord.js");
const config = require("./config.json");
var fs = require('fs');
var request = require('request');
const { exit } = require("process");
var projectDir = "/home/pi/Desktop/cryptobot/"
var saveFileName = projectDir + 'storedData.json';
var ready = false;
var fail = false;

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

function handlePriceCheck(i, symbol) {
    request.get({url: baseURL + symbol,
        json: true,
        headers: {}}, (err, res, data) => {
            if (err) {
                if (fail)
			client.channels.cache.get(saves.lastChannelId).send("There was a problem connecting to coinmarketcap's servers. Please see developer log for details.");
                fail = true;
		console.error(err);
        } else if (res.statusCode != 200) {
            console.error("Error: Non-OK status received: " + res.statusCode);
	    if (fail) 
            	client.channels.cache.get(saves.lastChannelId).send("Oops! I wasn't able to reach coinmarketcap's servers. (Error code " + res.statusCode + ")");
	    fail = true;
        } else {
            if (!data.data[symbol]) {
		if (fail)
                	client.channels.cache.get(saves.lastChannelId).send("I was unable to fetch price info for " + symbol + ". I'll try again in a bit.");
		fail = true;
                return;
            }
            const price = data.data[symbol].quote.USD.price;
            const difference = price - saves.lastPriceNotified[i];
            //console.log("i = " + i);
            const percentageDifference = (difference/saves.lastPriceNotified[i])*100;
	    fail = false;
            //console.log("New price for " + symbol + ": " + price);
            //console.log("difference of " + difference);
            //console.log("Found " + percentageDifference + " difference for " + symbol);
            if (Math.abs(percentageDifference) >= saves.alertThresholds[i]) {
                if (percentageDifference < 0 ) {
                    client.channels.cache.get(saves.lastChannelId).send(symbol + " PRICE CHANGE ALERT: Price is now " + price + " USD, a decrease of " +
                        Math.abs(difference) + " USD (" + Math.abs(percentageDifference).toFixed(1) + "%) since " + saves.lastDateNotified[i].toLocaleString("en-US"));
                } else {
                    client.channels.cache.get(saves.lastChannelId).send(symbol + " PRICE CHANGE ALERT: Price is now " + price + " USD, an increase of " +
                        difference + " USD (" + percentageDifference.toFixed(1) + "%) since " + saves.lastDateNotified[i].toLocaleString("en-US"));
                }
                saves.lastPriceNotified[i] = price;
                saves.lastDateNotified[i] = new Date();
		saveConfig();
            }
            
        }
    })
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
        "`!watch <crypto-symbol> <percentage-change>`: Watch a specified crypto currency and notify the active channel when the price changes by the specified percentage. \n" +
        "`!remove <crypto-symbol>`: Stops watching a specified cryptocurrency.\n" + 
        "`!list`: Lists all cryptocurrencies that are currently being watched, and their price fluctuation thresholds.\n" + 
        "`!check <crypto-symbol>`: Checks the price of a specified cryptocurrency in USD.");
}
else if (command == "watch") {
    if (args.length == 0) {
        message.channel.send("Usage: `!watch <symbol> <percentage-change>`. Example command: `!watch BTC 20` (this watches Bitcoin and sends an alert when the price fluctuates by more than 20%. ");
        return;
    } else if (args.length < 2) {
        message.channel.send("You need to include a percentage change threshold to alert you of. Example command: `!watch BTC 20` (this watches Bitcoin and sends an alert when the price fluctuates by more than 20%.")
        return;
    }
    if (!Number(args[1])) {
        message.channel.send("\"" + args[1] + "\" is not a number! Example command: `!watch BTC 20` (this watches Bitcoin and sends an alert when the price fluctuates by more than 20%.");
        return;
    }

    const symbol = args[0].toUpperCase();
    const coinIndex = saves.coinSymbols.indexOf(symbol);
    if (coinIndex != -1 ) {
        message.channel.send("Now setting alert threshold for " + symbol + " from " + saves.alertThresholds[coinIndex] + "% to " + args[1] + "%.");
        saves.alertThresholds[coinIndex] = Math.abs(Number(args[1]));
        saveConfig();
    } else {
        if (!symbol) {
            message.channel.send("I didn't receive a proper symbol! Please try again.");
        }
        request.get({url: baseURL + symbol,
            json: true,
            headers: {}}, (err, res, data) => {
                if (err) {
                    client.channels.cache.get(saves.lastChannelId).send("There was a problem connecting to coinmarketcap's servers. Please see developer log for details.");
                    console.error(err);
            } else if (res.statusCode != 200) {
                console.error("Error: Non-OK status received: " + res.statusCode);
                message.channel.send("Oops! I wasn't able to reach coinmarketcap's servers. (Error code " + res.statusCode + ")");
            } else {
                if (!data.data[symbol]) {
                    message.channel.send("Couldn't find a coin with the symbol: " + symbol);
                    return;
                }
                const price = data.data[symbol].quote.USD.price;
                const name = data.data[symbol].name;
                saves.coinSymbols.push(symbol);
                saves.alertThresholds.push(Math.abs(Number(args[1])));
                saves.lastPriceNotified.push(price);
                saves.lastDateNotified.push(new Date());
                message.channel.send("Now watching " + name + " (" + args[0].toUpperCase() + ") for price change of " + args[1] + "%");
                client.user.setActivity(saves.coinSymbols.length + " cryptocurrencies", {type: 'WATCHING'});
		saveConfig();
            }
            
        });     
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
    //console.log(getPrice(args[0]));
    const symbol = args[0].toUpperCase();
    if (!symbol) return undefined;
    request.get({url: baseURL + symbol,
        json: true,
        headers: {}}, (err, res, data) => {
            if (err) {
                client.channels.cache.get(saves.lastChannelId).send("There was a problem connecting to coinmarketcap's servers. Please check the developer log for details.");
                console.error(err);
        } else if (res.statusCode != 200) {
            console.error("Error: Non-OK status received: " + res.statusCode);
            message.channel.send("Oops! I wasn't able to reach coinmarketcap's servers. (Error code " + res.statusCode + ")");
        } else {
            if (!data.data[symbol]) {
                message.channel.send("Couldn't find a coin with the symbol: " + symbol);
                return;
            }
            const price = data.data[symbol].quote.USD.price;
            message.channel.send("The current price of " + symbol + " is " + price + " USD");
        }});  

}
else if (command == "list") {
    if (saves.coinSymbols.length == 0) {
        message.channel.send("I am currently not watching any currencies!");
    } else {
        var msgtext = "I am currently watching the following currencies: \n\n";
        for (var i = 0; i < saves.coinSymbols.length; i++) {
            msgtext += saves.coinSymbols[i] + " for a " + saves.alertThresholds[i] + "% change\n";
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
            //console.log("i = " + i);
            const symbol = saves.coinSymbols[i];
            handlePriceCheck(i, symbol); 
        }
        await sleep(30000);
        
    }
    //Check price
    //Do math
    //Notify (if necessary)
    //Sleep for 30 seconds

    //TODO: make sure new times and dates are saved
}


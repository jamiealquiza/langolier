#!/usr/bin/env node

var settings = require('./settings.js'),
    fs = require('fs'),
    elasticsearch = require('elasticsearch'),
    AWS = require('aws-sdk');

// Init & misc.
AWS.config.update({accessKeyId: settings.aws.accessKeyId, secretAccessKey: settings.aws.secretAccessKey, region: settings.aws.region});

function alertInfo(message) {
  console.log(Date() + " [INFO]: " + message)
}

function writeLog(message, level) {
  fs.appendFile(settings.logFile, Date() + " [" + level + "]: " + message + "\n", function (err) {
    if (err) throw err;
  });
}

// Create clients
var clientEs = new elasticsearch.Client({
  host: settings.es.host + ':' + settings.es.port,
  apiVersion: settings.es.apiVer,
  //log: 'trace'
});
writeLog("Connected to ElasticSearch on " + settings.es.host + ':' + settings.es.port, "INFO")

function estabSqs() {
  clientSqs = new AWS.SQS({region: settings.aws.region});
  writeLog("Listening for events on " + settings.aws.sqsUrl, "INFO");
}
estabSqs(); // Initial connection
setInterval(estabSqs, 300000); // Refresh every 5 minutes to prevent AWS 15min timeout

// ElasticSearch Functions
function indexMsg(message, receipt) { 
  clientEs.create({
    index: settings.index,
    type: message[0], 
    body: message[1] 
  }, function (err, resp) {
    if (err) { 
      writeLog(err, "WARN"); 
    }
    else {
      delMsg(receipt); // Message isn't removed from queue unless indexing is successful 
      writeLog("Wrote to index: " + settings.index + " with type: " + message[0], "INFO");
    }
  });
};

// AWS Functions 
var sqsParams = {
  QueueUrl: settings.aws.sqsUrl,
  MaxNumberOfMessages: 1, // Speed doesn't matter enough yet to deal with batches
  WaitTimeSeconds: 5,
};

function getMsg() {
  clientSqs.receiveMessage(sqsParams, function (err, data) {
    if (err) writeLog(err, "WARN");
    else {
      if (data.Messages) {
        var receipt = data.Messages[0].ReceiptHandle,
            body = JSON.parse(data.Messages[0].Body);
        message = [];
        message[0] = body.DataType; // DataType key defines type in ElasticSearch
        message[1] = body.Message; // Message object contains the actual data
        indexMsg(message, receipt); // Send [ 'DataType', 'Message' ] + SQS receipt to ES (see delMsg callback)
      };
    getMsg(); // Long-poll for 'WaitTimeSeconds', callback to self if message is available
    };
  });
};

function delMsg(receipt) {
  clientSqs.deleteMessage({
    QueueUrl: settings.aws.sqsUrl,
    ReceiptHandle: receipt,
  }, function(err, data) {
    if (err) writeLog(err, "WARN");
  });
};

// Kick it off
getMsg();

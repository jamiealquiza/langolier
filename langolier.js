#!/usr/bin/env node

//The MIT License (MIT)
//
//Copyright (c) 2014 Jamie Alquiza 
//
//Permission is hereby granted, free of charge, to any person obtaining a copy
//of this software and associated documentation files (the "Software"), to deal
//in the Software without restriction, including without limitation the rights
//to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//copies of the Software, and to permit persons to whom the Software is
//furnished to do so, subject to the following conditions:
//
//The above copyright notice and this permission notice shall be included in
//all copies or substantial portions of the Software.
//
//THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
//THE SOFTWARE.

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
  apiVersion: settings.es.apiVer
});

clientEs.ping({
  requestTimeout: 1000,
}, function (err) {
  if (err) {
    writeLog(err, "WARN");
  }
  else {
    writeLog("Connected to ElasticSearch on " + settings.es.host + ':' + settings.es.port, "INFO");
  };
});

function estabSqs() {
  clientSqs = new AWS.SQS({region: settings.aws.region});
  clientSqs.getQueueAttributes({QueueUrl: settings.aws.sqsUrl}, function(err, data) {
    if (err) {
      writeLog(err, "WARN");
    }
    else {
      writeLog("Listening for events on " + settings.aws.sqsUrl, "INFO");
    };
  });
}
estabSqs(); // Initial connection
setInterval(estabSqs, 300000); // Refresh conn; AWS API has 15 min timeout

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
      delMsg(receipt); 
      writeLog("Wrote to index: " + settings.index + " with type: " + message[0], "INFO");
    };
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
        message[1] = body.Message; // Message object becomes ES document _source data
        indexMsg(message, receipt); // Send "[ 'DataType', 'Message' ]" & "SQS receipt" to ES
      };
    getMsg(); // Long-poll for 'WaitTimeSeconds', immediate callback to self if message is available
    };
  });
};

// Callback on successful ES indexing
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

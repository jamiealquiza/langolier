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

var settings = require('./settings.js');
var fs = require('fs');
var elasticsearch = require('elasticsearch');
var AWS = require('aws-sdk');


// --- Init & Misc. --- //

AWS.config.update({
  accessKeyId: settings.aws.accessKeyId,
  secretAccessKey: settings.aws.secretAccessKey,
  region: settings.aws.region
});


function writeLog(message, level) {
  fs.appendFile(settings.logFile, Date() + " [" + level + "]: " + message + "\n", function (err) {
    if (err) throw err;
  });
}


// --- Output: ElasticSearch --- //

// Init
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

// Functions
function indexMsg(message, receipts) {
  clientEs.bulk({
    body: message
  }, function (err, resp) {
    if (err) {
      writeLog(err, "WARN");
    }
    else {
      writeLog("Wrote "+ message.length + " items to index '" + settings.index + "' in " + resp.took + "ms", "INFO");
      delSqsMsg(receipts);
    };
  });
};


// --- Input: AWS SQS --- //

// Init
var sqsParams = {
  QueueUrl: settings.aws.sqsUrl,
  MaxNumberOfMessages: 10,
  WaitTimeSeconds: 5,
};

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

// Functions
function parseSqsMsg(messages) {
  var msgCount = messages.length;
  var docs = [];
  var receipts = [];
  var doc = {};
  var receipt = {};
  for (var msg = 0; msg < msgCount; msg++) {
    var rcpt = messages[msg].ReceiptHandle;
    var body = JSON.parse(messages[msg].Body);
    doc = { index: {
        _index: settings.index,
        _type: body.DataType,
        body: body.Message
      }
    };
    receipt = { Id: msg.toString(), ReceiptHandle: rcpt };
    docs.push(doc);
    receipts.push(receipt);
  };
  indexMsg(docs, receipts)
}

function pollSqs() {
  clientSqs.receiveMessage(sqsParams, function (err, data) {
    if (err) {
      writeLog(err, "WARN");
    } else {
      if (data.Messages) {
        parseSqsMsg(data.Messages)
      };
    pollSqs(); // Long-poll for 'WaitTimeSeconds', immediate call to self if message is available
    };
  });
};

// Callback on successful ES indexing
function delSqsMsg(receipts) {
  clientSqs.deleteMessageBatch({
    QueueUrl: settings.aws.sqsUrl,
    Entries: receipts
  }, function(err, resp) {
    if (err) writeLog(err, "WARN")
  });
};

// Service
estabSqs(); // Initial connection
setInterval(estabSqs, 300000); // Refresh conn; AWS API has 15 min timeout
pollSqs();

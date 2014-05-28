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
var crypto = require('crypto');
var cluster = require('cluster');
var elasticsearch = require('elasticsearch');
var AWS = require('aws-sdk');


var workers = settings.workers;

if (cluster.isMaster) {
  for (var i = 0; i < workers; i++) {
    cluster.fork();
  }

  cluster.on('exit', function(worker, code, signal) {
    writeLog("Worker died, respawning", "WARN");
    cluster.fork();
  });
} else {

  // --- Init & Misc. --- //

  AWS.config.update({
    accessKeyId: settings.sqs.accessKeyId,
    secretAccessKey: settings.sqs.secretAccessKey,
    region: settings.sqs.region
  });

  function writeLog(message, level) {
    if (settings.logConsole) {
      console.log(Date() + " [" + level + "]: " + message);
    } else {
      fs.appendFile(settings.logFile, Date() + " [" + level + "]: " + message + "\n", function (err) {
        if (err) throw err;
      });
    }
  }

  function hashId(input) {
    var hash = crypto.createHash('sha1');
    hash.setEncoding('hex');
    hash.write(input);
    hash.end();
    return hash.read()
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

  // General
  function indexMsg(message, receipts) {
    clientEs.bulk({
      body: message
    }, function (err, resp) {
      if (err) {
        writeLog(err, "WARN");
      }
      else {
        writeLog("Wrote "+ message.length/2 + " items to index '" + settings.es.index + "' in " + resp.took + "ms", "INFO");
        delSqsMsg(receipts);
      };
    });
  };


  // --- Input: AWS SQS --- //

  // Init
  var sqsParams = {
    QueueUrl: settings.sqs.sqsUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 5,
  };

  function estabSqs() {
    clientSqs = new AWS.SQS({region: settings.sqs.region});
    clientSqs.getQueueAttributes({QueueUrl: settings.sqs.sqsUrl}, function(err, data) {
      if (err) {
        writeLog(err, "WARN");
      }
      else {
        writeLog("Listening for events on " + settings.sqs.sqsUrl, "INFO");
      };
    });
  }

  // General
  function parseSqsMsg(messages) {
    var msgCount = messages.length;
    var docs = [];
    var receipts = [];
    var meta = {};
    var doc = {};
    var receipt = {};
    for (var msg = 0; msg < msgCount; msg++) {
      var rcpt = messages[msg].ReceiptHandle;
      var body = JSON.parse(messages[msg].Body);
      meta = { index: {
        _index: settings.es.index,
        _type: body.DataType,
        _id: hashId(JSON.stringify(body.Message)) }
      };
      doc = body.Message;
      receipt = { Id: msg.toString(), ReceiptHandle: rcpt };
      docs.push(meta, doc);
      receipts.push(receipt);
    };
    //console.log(docs)
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
      QueueUrl: settings.sqs.sqsUrl,
      Entries: receipts
    }, function(err, resp) {
      if (err) writeLog(err, "WARN")
    });
  };

  // Service
  estabSqs(); // Initial connection
  setInterval(estabSqs, 300000); // Refresh conn; AWS API has 15 min timeout
  pollSqs();

}
